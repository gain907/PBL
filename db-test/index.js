const mysql = require('mysql2');

const connection = mysql.createConnection({
  host: 'tango-db-instance.c7waoiau6k85.ap-southeast-2.rds.amazonaws.com',
  user: 'admin',
  password: 'yeum080226', // 설정하신 마스터 비밀번호 입력
  port: 3306,
  ssl: {
    rejectUnauthorized: false
  }
});

connection.connect((err) => {
  if (err) {
    console.error('데이터베이스 연결 실패:', err.message);
    return;
  }
  console.log('AWS RDS MariaDB 연결 성공!');
  connection.end();
});