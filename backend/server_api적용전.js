// tango-backend/server.js
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5001;

// ★ 중요: CORS와 JSON 설정은 반드시 라우터보다 위에 있어야 합니다!
app.use(cors());
app.use(express.json());

// 1. AWS RDS MariaDB 연결 풀(Pool) 설정
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'tango-db-instance.c7waoiau6k85.ap-southeast-2.rds.amazonaws.com',
    user: process.env.DB_USER || 'admin',
    password: process.env.DB_PASSWORD || 'yeum080226',
    database: process.env.DB_NAME || 'tango_db',
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    ssl: {
        rejectUnauthorized: false
    }
});

// 연결 테스트
pool.getConnection()
    .then(connection => {
        console.log('✨ AWS RDS MariaDB 데이터베이스 연결 성공!');
        connection.release();
    })
    .catch(err => {
        console.error('❌ 데이터베이스 연결 실패:', err.message);
    });

// 2. [API] 데이터 저장하기 (POST)
app.post('/api/records', async (req, res) => {
    try {
        const { name, grade, age, record_date, file_name, summary, dialogue_json } = req.body;
        
        const query = `
            INSERT INTO tango_records (name, grade, age, record_date, file_name, summary, dialogue_json, status) 
            VALUES (?, ?, ?, ?, ?, ?, ?, 'SAVED')
        `;
        
        const [result] = await pool.query(query, [
            name, grade, age, record_date, file_name, summary, JSON.stringify(dialogue_json)
        ]);

        res.status(201).json({ success: true, message: '데이터가 성공적으로 저장되었습니다!', id: result.insertId });
    } catch (error) {
        console.error('저장 에러:', error);
        res.status(500).json({ success: false, message: '서버 에러가 발생했습니다.' });
    }
});

// 3. [API] 저장된 데이터 불러오기 (GET)
app.get('/api/records/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const [rows] = await pool.query('SELECT * FROM tango_records WHERE id = ?', [id]);

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: '데이터를 찾을 수 없습니다.' });
        }

        res.status(200).json({ success: true, data: rows[0] });
    } catch (error) {
        console.error('조회 에러:', error);
        res.status(500).json({ success: false, message: '서버 에러가 발생했습니다.' });
    }
});

// 서버 실행
app.listen(PORT, () => {
    console.log(`🚀 백엔드 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
});