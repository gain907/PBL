// src/App.js
import React, { useState, useRef, useEffect } from 'react';
import { FileAudio, Plus, RotateCcw, Trash2, Calendar, Headphones, List, MessageSquare } from 'lucide-react';
import './App.css'; // CSS 파일 불러오기

function App() {
  const [step, setStep] = useState(1); // 1: 업로드 전, 2: 업로드 후
  const [audioFile, setAudioFile] = useState(null);
  const [audioUrl, setAudioUrl] = useState('');
  
  // 🌟 [수정됨] 상태를 '대기', '분석중', '완료' 세 가지로 세분화했습니다.
  const [analysisStatus, setAnalysisStatus] = useState('WAITING'); // WAITING | PROCESSING | COMPLETED
  
  const [recordId, setRecordId] = useState(null); // DB에 저장된 고유 ID
  const [analysisData, setAnalysisData] = useState({ summary: '', dialogue: [] }); // DB에서 불러온 분석 데이터

  const fileInputRef = useRef(null);

  // 파일 선택 창 열기
  const handleAddClick = () => {
    fileInputRef.current.click();
  };

  // 🚀 파일 첨부 시 실행 (백엔드에 비동기 처리 요청)
  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (file) {
      setAudioFile(file);
      setAudioUrl(URL.createObjectURL(file));
      
      // 🌟 [수정됨] 파일 첨부 즉시 '분석 중' 상태로 진입합니다.
      setAnalysisStatus('PROCESSING'); 
      setStep(2); 

      try {
        const formData = new FormData();
        formData.append('audio', file);
        formData.append('name', '한은희');
        formData.append('grade', 'T3 B등급');
        formData.append('age', 63);
        formData.append('record_date', '2026-10-26'); 

        // 비동기 1단계: 백엔드로 파일과 정보 전송 (요약 결과는 안 오고 접수증(ID)만 옴)
        const response = await fetch('http://localhost:5001/api/records', {
          method: 'POST',
          body: formData 
        });

        const result = await response.json();
        
        if (result.success) {
          console.log("AI 분석 요청 접수 완료! 생성된 ID:", result.id);
          setRecordId(result.id); 
        } else {
          console.error("서버 접수 실패:", result.message);
          setAnalysisStatus('WAITING'); // 실패 시 상태 복구
        }
      } catch (error) {
        console.error("서버 통신 에러:", error);
        setAnalysisStatus('WAITING');
      }
    }
  };

  // 파일 삭제 및 초기화
  const handleReset = () => {
    setAudioFile(null);
    setAudioUrl('');
    setAnalysisStatus('WAITING');
    setRecordId(null);
    setAnalysisData({ summary: '', dialogue: [] });
    setStep(1);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };


  // 🌟 [추가됨] 폴링(Polling) 로직: '분석 중' 상태일 때 3초마다 백엔드를 찔러봅니다.
  useEffect(() => {
    let pollingInterval;

    const checkAnalysisStatus = async () => {
      if (!recordId) return;

      try {
        const response = await fetch(`http://localhost:5001/api/records/${recordId}`);
        const result = await response.json();

        if (result.success && result.data) {
          // 백엔드 DB의 상태가 'SAVED'로 바뀌었다면 (웹훅 처리가 끝났다면)
          if (result.data.status === 'SAVED') {
            
            let parsedDialogue = [];
            try {
              parsedDialogue = typeof result.data.dialogue_json === 'string' 
                ? JSON.parse(result.data.dialogue_json) 
                : result.data.dialogue_json;
            } catch (e) {
              parsedDialogue = [];
            }

            setAnalysisData({
              summary: result.data.summary,
              dialogue: parsedDialogue
            });

            setAnalysisStatus('COMPLETED'); // 상태를 '완료'로 변경하여 폴링 중지 및 화면 렌더링
            console.log("✨ 웹훅 결과 수신 및 화면 업데이트 완료!");
          }
        }
      } catch (error) {
        console.error("상태 확인 중 에러 발생:", error);
      }
    };

    // 현재 상태가 'PROCESSING'이고 recordId가 있을 때만 3초 간격으로 확인
    if (analysisStatus === 'PROCESSING' && recordId) {
      pollingInterval = setInterval(checkAnalysisStatus, 3000);
    }

    // 컴포넌트가 사라지거나 상태가 바뀌면 타이머를 정리(Clean up)합니다.
    return () => {
      if (pollingInterval) clearInterval(pollingInterval);
    };
  }, [analysisStatus, recordId]); 
  // ⬆️ 상태 변수가 바뀔 때마다 위 로직이 재실행됩니다.


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
              <span className={`status-badge ${analysisStatus === 'COMPLETED' ? 'active' : ''}`}>
                {analysisStatus === 'COMPLETED' ? '저장 완료' : '분석 중...'}
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
            </div>
            {/* 🌟 [수정됨] 자동 폴링 처리되므로 수동 '분석하기' 버튼과 하단 텍스트는 삭제했습니다. */}
          </div>

          {/* 2. 요약 카드 */}
          <div className="card">
            <div className="card-header">
              <div className="card-title" style={{ color: '#e53e5d' }}>
                <List size={20} /> 요약
              </div>
            </div>
            
            {/* 🌟 [수정됨] 상태에 따라 화면 표시를 나눕니다. */}
            {analysisStatus === 'COMPLETED' ? (
              <div className="result-text">{analysisData.summary}</div>
            ) : analysisStatus === 'PROCESSING' ? (
              <div className="placeholder-box" style={{ color: '#3182ce' }}>⏳ AI가 내용을 분석하고 요약 중입니다... (최대 1~2분 소요)</div>
            ) : (
              <div className="placeholder-box">파일을 업로드해 주세요.</div>
            )}
          </div>

          {/* 3. 화자별 대화 카드 */}
          <div className="card">
            <div className="card-header">
              <div className="card-title" style={{ color: '#e53e5d' }}>
                <MessageSquare size={20} /> 화자별 대화
              </div>
            </div>

            {/* 🌟 [수정됨] 상태에 따라 화면 표시를 나눕니다. */}
            {analysisStatus === 'COMPLETED' ? (
              <div className="result-text">
                {analysisData.dialogue.map((item, index) => (
                  <div className="speaker-row" key={index}>
                    <span className="speaker-name">{item.speaker}:</span> {item.text}
                  </div>
                ))}
              </div>
            ) : analysisStatus === 'PROCESSING' ? (
               <div className="placeholder-box" style={{ color: '#3182ce' }}>⏳ 음성을 텍스트로 변환 중입니다...</div>
            ) : (
               <div className="placeholder-box">파일을 업로드해 주세요.</div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export default App;