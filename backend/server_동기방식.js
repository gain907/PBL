// 🌟 [수정됨: 필수] 환경변수를 메모리에 가장 먼저 올리기 위해 최상단으로 이동
require('dotenv').config();

const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const multer = require('multer');
const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data'); // 네이버 API 전송용

// 🌟 [추가됨] AWS S3 통신을 위한 패키지 불러오기
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors());
app.use(express.json());

// 파일 업로드 설정 (로컬 uploads 폴더에 임시 저장)
const upload = multer({ dest: 'uploads/' });

// AWS RDS MariaDB 연결 풀 설정
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

// 🌟 [추가됨] AWS S3 클라이언트 설정 (.env의 자격 증명 사용)
const s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

// 🚀 [핵심 API] 음성 파일 업로드 ➡️ CLOVA Speech(화자분리 STT) ➡️ CLOVA Studio(AI 요약) ➡️ DB 저장
// 🚀 [비동기 1단계] 음성 업로드 및 네이버에 분석 '요청'만 하고 즉시 종료 (빠른 응답)
app.post('/api/records', upload.single('audio'), async (req, res) => {
    let filePath = null;
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: '음성 파일이 없습니다.' });
        }

        filePath = req.file.path;
        // const file_name = req.file.originalname; 한글이 깨짐
        // 1. 깨진 파일명을 원래 한글(UTF-8) 규격으로 복구
        const decodedName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
        const { name, grade, age, record_date } = req.body;

       // 0단계: 네이버에 쏘기 전, 오디오 원본을 AWS S3에 먼저 영구 업로드
        console.log(`☁️ [0단계] AWS S3에 음성 파일 업로드 시작...`);
        const fileStream = fs.readFileSync(filePath);
        // const s3FileName = `${Date.now()}_${file_name}`; // 고유 파일명 생성 (예: 17000000000_audio.wav)
        // 2. 복구된 한글 파일명으로 S3 저장용 이름 조합
        const s3FileName = `${Date.now()}_${decodedName}`;

        await s3Client.send(new PutObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: s3FileName,
            Body: fileStream,
            ContentType: req.file.mimetype,
            ACL: 'public-read' // 프론트엔드에서 누구나 재생할 수 있도록 권한 개방
        }));
        
        // 업로드 성공 후 영구 재생 가능한 URL 획득
        const s3AudioUrl = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3FileName}`;
        console.log(`✅ [0단계 완료] S3 업로드 성공! 파일 주소: ${s3AudioUrl}`);

        console.log(`🎙️ [1단계] 네이버 CLOVA Speech에 비동기(Async) 요청 시작`);

        // 1. CLOVA Speech API 호출 준비 (FormData 방식)
        const formData = new FormData();
        formData.append('media', fs.createReadStream(filePath));
        
        // // 화자 분리가 포함된 요청 옵션 설정
        // const params = {
        //     language: 'ko-KR',
        //     completion: 'sync', // 동기 방식 (완료될 때까지 대기)
        //     diarization: { enable: true } // 화자 분리 활성화
        // };
        // 🌟 [비동기 변경됨] completion을 async로 바꾸고, 웹훅 콜백 주소를 추가합니다.
        const params = {
            language: 'ko-KR',
            completion: 'async', // ⬅️ 비동기 전환
            callback: process.env.WEBHOOK_URL, // ⬅️ 예: 'https://내-ngrok-주소/api/webhook'
            diarization: { enable: true }
        };
        formData.append('params', JSON.stringify(params));

        // CLOVA Speech 요청
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

        // STT 결과에서 텍스트 및 화자별 대화 추출
        const segments = speechResponse.data.segments || [];
        let fullTranscript = '';
        const dialogueJson = segments.map(seg => {
            const speakerName = seg.diarization?.label === '1' ? '간호사/상담사' : '어르신';
            const text = seg.text;
            fullTranscript += `${speakerName}: ${text}\n`;
            return { speaker: speakerName, text: text };
        });

        console.log(`✨ [1단계 완료] STT 및 화자 분리 성공! 총 발화 횟수: ${segments.length}건`);

        // 2. CLOVA Studio (HyperCLOVA X) 호출하여 간호 요약 생성
        console.log(`🧠 [2단계] CLOVA Studio에 요약 요청 시작...`);

        const studioResponse = await axios.post(
            'https://clovastudio.stream.ntruss.com/testapp/v1/chat-completions/HCX-DASH-001',
            {
                messages: [
                    { 
                        role: 'system', 
                        content: '당신은 전문 의료/간호 기록 AI입니다. 아래의 화자별 대화 내용을 바탕으로 어르신의 건강 상태, 주요 호소 증상, 그리고 향후 조치 사항을 핵심 위주로 요약해 주세요.' 
                    },
                    { 
                        role: 'user', 
                        content: fullTranscript 
                    }
                ],
                temperature: 0.3,
                maxTokens: 500
            },
            {
                headers: {
                    'Authorization': `Bearer ${process.env.CLOVA_STUDIO_API_KEY}`, // <--- 이렇게 최신 방식으로 변경! (따옴표 주의: 백틱 ` 입니다)
                    'Content-Type': 'application/json'
                }
            }
        );

        const aiSummary = studioResponse.data.result.message.content;
        console.log(`✨ [2단계 완료] AI 요약 성공!`);

        // // 3. AWS RDS MariaDB에 저장
        // const query = `
        //     INSERT INTO tango_records (name, grade, age, record_date, file_name, summary, dialogue_json, status) 
        //     VALUES (?, ?, ?, ?, ?, ?, ?, 'SAVED')
        // `;
        
        // 🌟 [수정됨] 3. AWS RDS MariaDB에 저장 (audio_url 컬럼과 변수 추가)
        const query = `
            INSERT INTO tango_records (name, grade, age, record_date, file_name, summary, dialogue_json, status, audio_url) 
            VALUES (?, ?, ?, ?, ?, ?, ?, 'SAVED', ?)
        `;

        const [dbResult] = await pool.query(query, [
            name || '한은희', 
            grade || 'T3 B등급', 
            age || 63, 
            record_date || '2026-10-26', 
            decodedName, // ✅ 복구된 한글 파일명 변수로 교체합니다.
            // file_name, 
            aiSummary, 
            JSON.stringify(dialogueJson),
            s3AudioUrl // ⬅️ S3에서 발급받은 영구 주소를 DB 마지막 칸에 삽입
        ]);

        // 임시 파일 삭제 (서버 용량 관리)
        if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);

        res.status(201).json({ 
            success: true, 
            message: '음성 분석 및 DB 저장 완료!', 
            id: dbResult.insertId 
        });

    } catch (error) {
        // 에러 발생 시에도 임시 파일 삭제
        if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);

        console.error('❌ 분석 및 저장 중 에러 발생:', error.response?.data || error.message);
        res.status(500).json({ 
            success: false, 
            message: 'AI 분석 중 오류가 발생했습니다.', 
            error: error.response?.data || error.message 
        });
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