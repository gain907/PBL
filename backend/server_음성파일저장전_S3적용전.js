const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const multer = require('multer');
const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data'); // 네이버 API 전송용
// 파일을 자동으로 찾아서 그 안에 적힌 모든 API 키와 비밀번호들을 Node.js의 메모리에 싹 올려놓는 역할
require('dotenv').config();

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

// 🚀 [핵심 API] 음성 파일 업로드 ➡️ CLOVA Speech(화자분리 STT) ➡️ CLOVA Studio(AI 요약) ➡️ DB 저장
app.post('/api/records', upload.single('audio'), async (req, res) => {
    let filePath = null;
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: '음성 파일이 없습니다.' });
        }

        filePath = req.file.path;
        const file_name = req.file.originalname;
        const { name, grade, age, record_date } = req.body;

        console.log(`🎙️ [1단계] 네이버 CLOVA Speech에 음성 파일 전송 시작: ${file_name}`);

        // 1. CLOVA Speech API 호출 준비 (FormData 방식)
        const formData = new FormData();
        formData.append('media', fs.createReadStream(filePath));
        
        // 화자 분리가 포함된 요청 옵션 설정
        const params = {
            language: 'ko-KR',
            completion: 'sync', // 동기 방식 (완료될 때까지 대기)
            diarization: { enable: true } // 화자 분리 활성화
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

        // 3. AWS RDS MariaDB에 저장
        const query = `
            INSERT INTO tango_records (name, grade, age, record_date, file_name, summary, dialogue_json, status) 
            VALUES (?, ?, ?, ?, ?, ?, ?, 'SAVED')
        `;
        
        const [dbResult] = await pool.query(query, [
            name || '한은희', 
            grade || 'T3 B등급', 
            age || 63, 
            record_date || '2026-10-26', 
            file_name, 
            aiSummary, 
            JSON.stringify(dialogueJson)
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