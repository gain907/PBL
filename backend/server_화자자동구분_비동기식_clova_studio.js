const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const multer = require('multer');
const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');

// 🌟 [수정됨: 필수] 환경변수를 메모리에 가장 먼저 올리기 위해 최상단으로 이동
require('dotenv').config();

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors());
app.use(express.json());

const upload = multer({ dest: 'uploads/' });

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    ssl: { rejectUnauthorized: false }
});

const s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

// 🚀 [비동기 1단계] 음성 파일 업로드 및 CLOVA Speech 분석 '요청' (결과 대기 안 함)
app.post('/api/records', upload.single('audio'), async (req, res) => {
    let filePath = null;
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: '음성 파일이 없습니다.' });
        }

        filePath = req.file.path;
        const decodedName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
        const { name, grade, age, record_date } = req.body;

        // 0단계: AWS S3에 음성 파일 업로드
        console.log(`☁️ [0단계] AWS S3에 음성 파일 업로드 시작...`);
        const fileStream = fs.readFileSync(filePath);
        const s3FileName = `${Date.now()}_${decodedName}`;

        await s3Client.send(new PutObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: s3FileName,
            Body: fileStream,
            ContentType: req.file.mimetype,
            ACL: 'public-read' 
        }));
        
        const s3AudioUrl = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3FileName}`;
        console.log(`✅ [0단계 완료] S3 업로드 성공! 파일 주소: ${s3AudioUrl}`);

        console.log(`🎙️ [1단계] 네이버 CLOVA Speech에 비동기(Async) 전송 시작: ${decodedName}`);

        const formData = new FormData();
        formData.append('media', fs.createReadStream(filePath));
        
        // 🌟 [비동기 변경됨] completion을 'async'로 변경하고 웹훅 URL(callback) 추가
        const params = {
            language: 'ko-KR',
            completion: 'async', // 비동기 방식
            callback: process.env.WEBHOOK_URL, // .env에 등록한 ngrok 외부 주소
            diarization: { enable: true } 
        };
        formData.append('params', JSON.stringify(params));

        const speechResponse = await axios.post(
            `${process.env.CLOVA_SPEECH_INVOKE_URL}/recognizer/upload`,
            formData,
            {
                headers: {
                    ...formData.getHeaders(),
                    'X-CLOVASPEECH-API-KEY': process.env.CLOVA_SPEECH_SECRET_KEY
                },
                maxContentLength: Infinity,
                maxBodyLength: Infinity
            }
        );

        // 🌟 [비동기 추가됨] 네이버 접수증(token) 획득
        const token = speechResponse.data.token;
        console.log(`✨ [1단계 요청 완료] 작업 토큰 획득: ${token}`);

        // 🌟 [비동기 변경됨] 요약 결과를 기다리지 않고 DB에 'PROCESSING' 상태로 기록 생성 (token 포함)
        const query = `
            INSERT INTO tango_records (name, grade, age, record_date, file_name, status, audio_url, token) 
            VALUES (?, ?, ?, ?, ?, 'PROCESSING', ?, ?)
        `;

        const [dbResult] = await pool.query(query, [
            name || '한은희', 
            grade || 'T3 B등급', 
            age || 63, 
            record_date || '2026-10-26', 
            decodedName, 
            s3AudioUrl,
            token 
        ]);

        if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);

        // 프론트엔드에 즉시 응답 전송
        res.status(202).json({ 
            success: true, 
            message: '음성 분석이 요청되었습니다.', 
            id: dbResult.insertId 
        });

    } catch (error) {
        if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
        console.error('❌ 요청 처리 중 에러 발생:', error.response?.data || error.message);
        res.status(500).json({ success: false, message: '요청 오류 발생', error: error.message });
    }
});


// 🌟 [비동기 추가됨] 🚀 [비동기 2단계] 네이버가 STT 완료 결과를 쏴주는 웹훅 수신처
app.post('/api/webhook', async (req, res) => {
    console.log(`📥 [웹훅 수신] 네이버 분석 결과 도착!`);

    try {
        const { token, segments } = req.body;
        if (!segments) return res.status(400).json({ message: '데이터 없음' });

        let fullTranscript = '';
        const dialogueJson = segments.map(seg => {
            const speakerName = seg.diarization?.label === '1' ? '간호사/상담사' : '어르신';
            const text = seg.text;
            fullTranscript += `${speakerName}: ${text}\n`;
            return { speaker: speakerName, text: text };
        });

        // 요약 모델은 CLOVA Studio 유지
        console.log(`🧠 [2단계] CLOVA Studio 요약 시작...`);
        const studioResponse = await axios.post(
            'https://clovastudio.stream.ntruss.com/testapp/v1/chat-completions/HCX-DASH-001',
            {
                messages: [
                    { role: 'system', content: '당신은 전문 의료/간호 기록 AI입니다. 요약해 주세요.' },
                    { role: 'user', content: fullTranscript }
                ],
                temperature: 0.3,
                maxTokens: 500
            },
            {
                headers: {
                    'Authorization': `Bearer ${process.env.CLOVA_STUDIO_API_KEY}`, 
                    'Content-Type': 'application/json'
                }
            }
        );

        const aiSummary = studioResponse.data.result.message.content;

        // 🌟 [비동기 변경됨] 접수번호(token)를 기준으로 기존 기록을 찾아 요약본 삽입 및 상태 변경
        const updateQuery = `
            UPDATE tango_records 
            SET summary = ?, dialogue_json = ?, status = 'SAVED' 
            WHERE token = ?
        `;
        
        await pool.query(updateQuery, [aiSummary, JSON.stringify(dialogueJson), token]);
        console.log(`✅ [웹훅 처리 완료] DB 업데이트 완료`);

        res.status(200).json({ message: 'Webhook Success' });
    } catch (error) {
        console.error('웹훅 오류:', error);
        res.status(500).json({ message: 'Webhook Error' });
    }
});

// 조회 API
app.get('/api/records/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const [rows] = await pool.query('SELECT * FROM tango_records WHERE id = ?', [id]);
        if (rows.length === 0) return res.status(404).json({ success: false, message: '데이터 없음' });
        res.status(200).json({ success: true, data: rows[0] });
    } catch (error) {
        console.error('조회 에러:', error);
        res.status(500).json({ success: false });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 백엔드 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
});