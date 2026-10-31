// src/App.js
import React, { useState, useRef } from 'react';
import { FileAudio, Plus, RotateCcw, Trash2, Calendar, Headphones, List, MessageSquare } from 'lucide-react';
import './App.css'; // CSS 파일 불러오기

function App() {
  const [step, setStep] = useState(1); // 1: 업로드 전, 2: 업로드 후
  const [audioFile, setAudioFile] = useState(null);
  const [audioUrl, setAudioUrl] = useState('');
  const [isAnalyzed, setIsAnalyzed] = useState(false);
  const [recordId, setRecordId] = useState(null); // DB에 저장된 고유 ID
  const [analysisData, setAnalysisData] = useState({ summary: '', dialogue: [] }); // DB에서 불러온 분석 데이터

  const fileInputRef = useRef(null);

  // 파일 선택 창 열기
  const handleAddClick = () => {
    fileInputRef.current.click();
  };

  // 파일 첨부 시 실행 (DB에 진짜 파일과 함께 분석 및 저장 요청)
  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (file) {
      setAudioFile(file);
      setAudioUrl(URL.createObjectURL(file));
      setIsAnalyzed(false);
      setStep(2); // 2단계 화면으로 이동

      // [핵심 변경] 파일 첨부 시 FormData를 사용해 백엔드로 진짜 음성 파일 전송
      try {
        const formData = new FormData();
        
        // 1. 'audio'라는 이름으로 음성 파일(file)을 담습니다. (백엔드의 upload.single('audio')와 매칭됨)
        formData.append('audio', file);
        
        // 2. 환자 정보를 함께 담습니다.
        formData.append('name', '한은희');
        formData.append('grade', 'T3 B등급');
        formData.append('age', 63);
        formData.append('record_date', '2026-10-26'); // 날짜 업데이트

        // 3. fetch를 통해 백엔드로 전송 (FormData는 headers에 Content-Type을 쓰지 않아야 브라우저가 자동 처리합니다)
        const response = await fetch('http://localhost:5001/api/records', {
          method: 'POST',
          body: formData 
        });

        const result = await response.json();
        
        if (result.success) {
          console.log("AI 분석 및 DB 저장 완료! 생성된 ID:", result.id);
          setRecordId(result.id); // 저장된 ID 보관
        } else {
          console.error("서버 처리 실패:", result.message);
        }
      } catch (error) {
        console.error("서버 통신 에러:", error);
      }
    }
  };

  // 파일 삭제 및 초기화
  const handleReset = () => {
    setAudioFile(null);
    setAudioUrl('');
    setIsAnalyzed(false);
    setRecordId(null);
    setAnalysisData({ summary: '', dialogue: [] });
    setStep(1);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // 분석하기 버튼 클릭 시 DB에서 저장된 데이터 불러와서 화면에 뿌리기
  const handleAnalyze = async () => {
    if (!recordId) {
      alert('저장된 데이터 아이디가 없습니다. 파일 분석이 완료될 때까지 기다려 주세요.');
      return;
    }

    try {
      // DB에 저장된 데이터 조회 API 호출
      const response = await fetch(`http://localhost:5001/api/records/${recordId}`);
      const result = await response.json();

      if (result.success) {
        const data = result.data;
        
        // DB에서 가져온 데이터를 상태에 반영
        let parsedDialogue = [];
        try {
          parsedDialogue = typeof data.dialogue_json === 'string' 
            ? JSON.parse(data.dialogue_json) 
            : data.dialogue_json;
        } catch (e) {
          parsedDialogue = [];
        }

        setAnalysisData({
          summary: data.summary,
          dialogue: parsedDialogue
        });

        setIsAnalyzed(true);
        console.log("DB에서 데이터를 성공적으로 불러와 화면에 적용했습니다!", data);
      } else {
        alert('데이터를 불러오지 못했습니다.');
      }
    } catch (error) {
      console.error("DB 조회 통신 에러:", error);
      alert('백엔드 서버와 통신할 수 없습니다.');
    }
  };

  return (
    <>
      <input 
        type="file" 
        accept="audio/*" 
        style={{ display: 'none' }} 
        ref={fileInputRef}
        onChange={handleFileChange}
      />

      {step === 1 && (
        <div className="upload-container">
          <div className="upload-icon-box">
            <FileAudio size={64} strokeWidth={1} />
          </div>
          <div className="upload-title">음성 파일을 이곳에 끌어놓으세요.</div>
          <div className="upload-subtitle">음성 파일만 · 최대 25MB · 분석 후 저장</div>
          <button className="btn-primary" onClick={handleAddClick}>
            <Plus size={20} /> 음성 파일 추가
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="dashboard-container">
          {/* 상단 헤더 영역 */}
          <div className="header-section">
            <div className="user-info">
              <span className="user-name">한은희</span>
              <span className="badge">T3 B등급</span>
              <span className="user-meta">입소인원 &nbsp;&nbsp; 63세</span>
            </div>
            <button className="btn-primary" onClick={handleAddClick}>
              <Plus size={18} /> 추가
            </button>
          </div>

          {/* 날짜 및 컨트롤 바 */}
          <div className="date-actions-row">
            <div className="date-box">
              <Calendar size={18} /> 2026년 10월 26일
            </div>
            <div className="action-buttons">
              <button className="btn-outline" onClick={handleReset}>
                <RotateCcw size={16} /> 초기화
              </button>
              <button className="btn-outline danger" onClick={handleReset}>
                <Trash2 size={16} /> 날짜 삭제
              </button>
            </div>
          </div>

          {/* 1. 음성 파일 카드 */}
          <div className="card">
            <div className="card-header">
              <div className="card-title">
                <Headphones size={20} color="#718096" /> 음성 파일
              </div>
              <span className={`status-badge ${isAnalyzed ? 'active' : ''}`}>
                {isAnalyzed ? '저장 완료' : '저장 전'}
              </span>
            </div>
            <div className="file-name">{audioFile?.name || 'record_out.wav'}</div>
            
            {audioUrl && (
              <audio className="audio-player" controls src={audioUrl} />
            )}

            <div className="card-actions">
              <button className="btn-outline" onClick={handleAddClick}>파일 변경</button>
              <button className="btn-outline danger" onClick={handleReset}>
                <Trash2 size={16} /> 파일 삭제
              </button>
              <button className="btn-outline" onClick={handleReset}>취소</button>
              <button className="btn-primary" onClick={handleAnalyze}>분석하기</button>
            </div>
            <div className="card-footer-text">
              분석하기를 누르면 DB에 저장된 내용이 불러와집니다.
            </div>
          </div>

          {/* 2. 요약 카드 */}
          <div className="card">
            <div className="card-header">
              <div className="card-title" style={{ color: '#e53e5d' }}>
                <List size={20} /> 요약
              </div>
            </div>
            {isAnalyzed ? (
              <div className="result-text">
                {analysisData.summary}
              </div>
            ) : (
              <div className="placeholder-box">AI 분석 후 요약이 표시됩니다.</div>
            )}
          </div>

          {/* 3. 화자별 대화 카드 */}
          <div className="card">
            <div className="card-header">
              <div className="card-title" style={{ color: '#e53e5d' }}>
                <MessageSquare size={20} /> 화자별 대화
              </div>
            </div>
            {isAnalyzed ? (
              <div className="result-text">
                {analysisData.dialogue.map((item, index) => (
                  <div className="speaker-row" key={index}>
                    <span className="speaker-name">{item.speaker}:</span> {item.text}
                  </div>
                ))}
              </div>
            ) : (
              <div className="placeholder-box">AI 분석 후 화자별 대화 내용이 표시됩니다.</div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export default App;