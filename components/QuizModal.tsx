
import React, { useState, useRef } from 'react';
import { ai } from '../services/geminiService';
import { CloseIcon, ArrowRightIcon, RefreshIcon } from './icons';
import { Type } from '@google/genai';

interface QuizModalProps {
    isOpen: boolean;
    onClose: () => void;
}

interface Question {
    question: string;
    options: string[];
    correctIndex: number;
    explanation: string;
}

const LOCATIONS = [
    "Thành Cổ Quảng Trị",
    "Nghĩa trang Liệt sĩ Trường Sơn",
    "Di tích Đôi bờ Hiền Lương - Bến Hải",
    "Địa đạo Vịnh Mốc",
    "Sân bay Tà Cơn",
    "Nhà tù Lao Bảo"
];

const QuizModal: React.FC<QuizModalProps> = ({ isOpen, onClose }) => {
    const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [questions, setQuestions] = useState<Question[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    
    // Track user's answer for each question index (null if not answered yet)
    const [userAnswers, setUserAnswers] = useState<(number | null)[]>([]);
    const [showResult, setShowResult] = useState(false);

    const generateQuiz = async (location: string) => {
        setLoading(true);
        setSelectedLocation(location);
        setQuestions([]);
        setUserAnswers([]);
        setCurrentIndex(0);
        setShowResult(false);

        try {
            const prompt = `Hãy soạn 1 bộ câu hỏi trắc nghiệm gồm 10 câu về di tích lịch sử: ${location} tại Quảng Trị.
            Các câu hỏi cần đa dạng về lịch sử, kiến trúc, và sự kiện.
            Định dạng trả về phải là một JSON Array (không bọc trong markdown), mỗi phần tử tuân theo cấu trúc này:
            {
                "question": "Nội dung câu hỏi",
                "options": ["Đáp án A", "Đáp án B", "Đáp án C", "Đáp án D"],
                "correctIndex": 0 (index 0-3),
                "explanation": "Giải thích chi tiết và thú vị"
            }
            Đảm bảo luôn có đủ 4 đáp án cho mỗi câu hỏi.`;

            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                question: { type: Type.STRING },
                                options: { type: Type.ARRAY, items: { type: Type.STRING } },
                                correctIndex: { type: Type.INTEGER },
                                explanation: { type: Type.STRING }
                            },
                            required: ["question", "options", "correctIndex", "explanation"]
                        }
                    }
                }
            });

            const text = response.text;
            if (text) {
                const data = JSON.parse(text) as Question[];
                setQuestions(data);
                setUserAnswers(new Array(data.length).fill(null));
            }
        } catch (error) {
            console.error("Error generating quiz:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleAnswer = (questionIndex: number, optionIndex: number) => {
        // Prevent changing answer if already answered
        if (userAnswers[questionIndex] !== null) return;

        const newAnswers = [...userAnswers];
        newAnswers[questionIndex] = optionIndex;
        setUserAnswers(newAnswers);
    };

    const nextQuestion = () => {
        if (currentIndex < questions.length - 1) {
            setCurrentIndex(currentIndex + 1);
        } else {
            setShowResult(true);
        }
    };

    const resetQuiz = () => {
        setSelectedLocation(null);
        setQuestions([]);
        setUserAnswers([]);
        setCurrentIndex(0);
        setShowResult(false);
    };

    const calculateScore = (): number => {
        return userAnswers.reduce((acc: number, answer, idx) => {
            // Safe check: questions[idx] might be undefined if something is out of sync
            if (questions[idx] && answer === questions[idx].correctIndex) {
                return acc + 1;
            }
            return acc;
        }, 0);
    };

    if (!isOpen) return null;

    // Safe access to current question data to prevent crashes
    const currentQuestion = questions[currentIndex];
    const hasAnsweredCurrent = userAnswers.length > currentIndex && userAnswers[currentIndex] !== null;
    const isCurrentCorrect = currentQuestion && hasAnsweredCurrent && userAnswers[currentIndex] === currentQuestion.correctIndex;

    // Animation classes
    // FIX: Using transform for the slider
    // The container width is N * 100%.
    // IMPORTANT: Child items must be 100% / N width to fit exactly one screen width.
    const trackWidthPercent = Math.max(questions.length, 1) * 100;
    const slideWidthPercent = questions.length > 0 ? 100 / questions.length : 100;

    const slideContainerStyle = {
        // If using percentages in translate on a wide element, it refers to the element's width.
        // So - (currentIndex / total) * 100 %.
        transform: `translateX(-${(currentIndex / Math.max(questions.length, 1)) * 100}%)`,
        width: `${trackWidthPercent}%`
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="relative w-full max-w-4xl bg-white/95 backdrop-blur-2xl rounded-3xl shadow-2xl overflow-hidden border border-white/50 flex flex-col max-h-[90vh] h-[85vh]">
                
                {/* Header */}
                <div className="bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 p-3 md:p-4 text-white flex justify-between items-center shrink-0 z-10">
                    <div>
                        <h2 className="text-lg font-bold flex items-center gap-2">
                            <span className="text-xl">🎓</span> Thử Tài Lịch Sử
                        </h2>
                        {selectedLocation && (
                            <p className="text-white/90 text-xs mt-0.5 uppercase tracking-wider font-medium truncate max-w-[200px] sm:max-w-md">
                                {selectedLocation}
                            </p>
                        )}
                    </div>
                    <button onClick={onClose} className="bg-white/20 hover:bg-white/30 p-1.5 rounded-full transition-colors">
                        <CloseIcon className="w-5 h-5" />
                    </button>
                </div>

                {/* Content Area */}
                <div className="flex-1 overflow-y-auto overflow-x-hidden relative bg-gray-50/30">
                    
                    {/* Phase 1: Selection */}
                    {!selectedLocation && (
                        <div className="p-6 animate-fade-in h-full overflow-y-auto custom-scrollbar">
                            <p className="text-gray-600 text-center font-medium mb-6 text-lg">Chọn địa điểm bạn muốn khám phá:</p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pb-6">
                                {LOCATIONS.map((loc) => (
                                    <button
                                        key={loc}
                                        onClick={() => generateQuiz(loc)}
                                        className="group relative p-4 rounded-xl border border-indigo-100 bg-gradient-to-br from-white to-indigo-50/50 hover:from-indigo-600 hover:to-purple-600 transition-all duration-300 shadow-sm hover:shadow-xl text-left"
                                    >
                                        <h3 className="font-bold text-base text-indigo-900 group-hover:text-white transition-colors mb-0.5">{loc}</h3>
                                        <p className="text-indigo-400 text-xs group-hover:text-indigo-100 transition-colors">Bắt đầu thử thách ➜</p>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Phase 2: Loading */}
                    {loading && (
                        <div className="flex flex-col items-center justify-center h-full space-y-4">
                            <div className="relative w-12 h-12">
                                <div className="absolute inset-0 rounded-full border-4 border-indigo-100"></div>
                                <div className="absolute inset-0 rounded-full border-4 border-indigo-600 border-t-transparent animate-spin"></div>
                                <div className="absolute inset-0 flex items-center justify-center text-lg animate-pulse">🧠</div>
                            </div>
                            <div className="text-center px-4">
                                <p className="text-indigo-900 font-bold text-base">AI đang soạn bộ câu hỏi...</p>
                                <p className="text-gray-500 text-xs mt-1">Đang tìm dữ liệu về {selectedLocation}</p>
                            </div>
                        </div>
                    )}

                    {/* Phase 3: Quiz Slider */}
                    {!loading && questions.length > 0 && !showResult && (
                        <div className="flex flex-col h-full">
                            {/* Progress Bar */}
                            <div className="w-full h-1.5 bg-gray-100 shrink-0">
                                <div 
                                    className="h-full bg-gradient-to-r from-indigo-500 to-pink-500 transition-all duration-500 ease-out"
                                    style={{ width: `${((currentIndex + 1) / questions.length) * 100}%` }}
                                ></div>
                            </div>
                            
                            <div className="px-4 py-2 flex justify-between items-center border-b border-gray-100 bg-white/50 backdrop-blur-md sticky top-0 z-10">
                                <span className="text-sm font-bold text-gray-500">
                                    Câu <span className="text-indigo-600 text-base">{currentIndex + 1}</span><span className="text-gray-300 mx-1">/</span>{questions.length}
                                </span>
                                <div className="flex gap-1">
                                    {questions.map((q, idx) => {
                                        const isAnswered = userAnswers[idx] !== null;
                                        const isCorrect = isAnswered && userAnswers[idx] === q.correctIndex;
                                        
                                        return (
                                            <div 
                                                key={idx} 
                                                className={`w-2 h-2 rounded-full transition-all ${
                                                    idx === currentIndex ? 'bg-indigo-600 scale-125' : 
                                                    isAnswered
                                                        ? (isCorrect ? 'bg-green-400' : 'bg-red-400')
                                                        : 'bg-gray-200'
                                                }`}
                                            />
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Horizontal Slider Container */}
                            <div className="flex-1 overflow-hidden relative w-full">
                                <div 
                                    className="flex h-full transition-transform duration-500 ease-[cubic-bezier(0.23,1,0.32,1)]" 
                                    style={slideContainerStyle}
                                >
                                    {questions.map((q, qIdx) => {
                                        const isAnswered = userAnswers[qIdx] !== null;
                                        
                                        return (
                                            <div 
                                                key={qIdx} 
                                                className="shrink-0 p-4 md:p-6 flex flex-col h-full overflow-y-auto custom-scrollbar" 
                                                style={{ width: `${slideWidthPercent}%` }}
                                            >
                                                <h3 className="text-base md:text-lg font-bold text-gray-800 leading-snug mb-3 break-words whitespace-normal">
                                                    {q.question}
                                                </h3>

                                                <div className={`flex flex-col gap-2.5 mb-4 transition-all duration-300 ${isAnswered ? 'pb-44' : 'pb-24'}`}>
                                                    {q.options.map((option, oIdx) => {
                                                        const isSelected = userAnswers[qIdx] === oIdx;
                                                        const isCorrectAnswer = oIdx === q.correctIndex;
                                                        const isWrongSelection = isSelected && !isCorrectAnswer;
                                                        const showCorrect = userAnswers[qIdx] !== null && isCorrectAnswer;

                                                        let btnClass = "w-full p-3 rounded-xl text-left font-medium border transition-all duration-200 relative overflow-hidden flex items-center group ";
                                                        
                                                        if (userAnswers[qIdx] === null) {
                                                            btnClass += "border-gray-200 bg-white hover:border-indigo-400 hover:bg-indigo-50 shadow-sm";
                                                        } else {
                                                            if (showCorrect) {
                                                                btnClass += "border-green-500 bg-green-50 text-green-900 shadow-green-100";
                                                            } else if (isWrongSelection) {
                                                                btnClass += "border-red-500 bg-red-50 text-red-900 opacity-70";
                                                            } else {
                                                                btnClass += "border-gray-100 bg-gray-50 text-gray-500 opacity-60 grayscale";
                                                            }
                                                        }

                                                        return (
                                                            <button
                                                                key={oIdx}
                                                                onClick={() => handleAnswer(qIdx, oIdx)}
                                                                disabled={userAnswers[qIdx] !== null}
                                                                className={btnClass}
                                                            >
                                                                <div className="flex items-start w-full">
                                                                    <span className={`w-6 h-6 rounded-full flex items-center justify-center mr-3 text-xs font-bold shadow-sm transition-colors flex-shrink-0 mt-0.5 ${
                                                                        showCorrect ? 'bg-green-500 text-white' :
                                                                        isWrongSelection ? 'bg-red-500 text-white' :
                                                                        'bg-gray-100 text-gray-600 group-hover:bg-indigo-200 group-hover:text-indigo-700'
                                                                    }`}>
                                                                        {String.fromCharCode(65 + oIdx)}
                                                                    </span>
                                                                    <span 
                                                                        className="flex-1 text-xs md:text-sm leading-relaxed break-words whitespace-normal" 
                                                                    >
                                                                        {option}
                                                                    </span>
                                                                    {showCorrect && <span className="text-base animate-bounce ml-2 shrink-0">✅</span>}
                                                                    {isWrongSelection && <span className="text-base ml-2 shrink-0">❌</span>}
                                                                </div>
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Footer Feedback Area - Fixed at bottom */}
                            <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-gray-100 bg-white/95 backdrop-blur-xl z-20 shadow-[0_-4px_20px_rgba(0,0,0,0.05)]">
                                {hasAnsweredCurrent ? (
                                    <div className="animate-slide-up max-w-4xl mx-auto w-full">
                                        <div className="flex items-center gap-2 mb-2">
                                            {isCurrentCorrect ? (
                                                <span className="text-green-600 font-bold text-base">🎉 Tuyệt vời!</span>
                                            ) : (
                                                <span className="text-red-600 font-bold text-base">🤔 Tiếc quá!</span>
                                            )}
                                            <span className="text-gray-300 text-sm hidden sm:inline">•</span>
                                            <span className="text-gray-600 font-medium text-sm hidden sm:inline">
                                                {isCurrentCorrect ? "Bạn đã trả lời đúng." : "Đáp án chưa chính xác."}
                                            </span>
                                        </div>
                                        <div className="bg-indigo-50 p-3 rounded-xl border border-indigo-100 shadow-sm mb-3 max-h-24 overflow-y-auto custom-scrollbar">
                                            <p className="text-gray-800 text-xs md:text-sm leading-relaxed">
                                                💡 {currentQuestion?.explanation}
                                            </p>
                                        </div>
                                        <button 
                                            onClick={nextQuestion}
                                            className="w-full md:w-auto md:px-6 py-2.5 bg-indigo-600 text-white rounded-lg font-bold shadow-lg shadow-indigo-200 hover:bg-indigo-700 hover:shadow-indigo-300 transition-all flex items-center justify-center gap-2 mx-auto text-sm"
                                        >
                                            {currentIndex < questions.length - 1 ? "Câu tiếp theo" : "Xem kết quả"} <ArrowRightIcon className="w-4 h-4" />
                                        </button>
                                    </div>
                                ) : (
                                    <div className="flex items-center justify-center py-1 text-gray-400 text-sm italic">
                                        Chọn một đáp án để tiếp tục...
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Phase 4: Results */}
                    {showResult && (
                        <div className="flex flex-col items-center justify-center h-full p-6 text-center animate-fade-in space-y-5">
                            <div className="relative">
                                <div className="w-24 h-24 rounded-full bg-gradient-to-tr from-indigo-500 to-pink-500 flex items-center justify-center text-white text-3xl font-bold shadow-xl mb-3">
                                    {calculateScore()}/10
                                </div>
                                <div className="absolute -bottom-2 -right-2 bg-yellow-400 text-yellow-900 text-[10px] font-bold px-3 py-0.5 rounded-full shadow-md border-2 border-white">
                                    ĐIỂM SỐ
                                </div>
                            </div>

                            <div>
                                <h3 className="text-xl font-bold text-gray-900 mb-1">
                                    {calculateScore() >= 8 ? "Xuất Sắc! 🏆" : 
                                     calculateScore() >= 5 ? "Làm Tốt Lắm! 👍" : 
                                     "Cố Gắng Hơn Nhé! 💪"}
                                </h3>
                                <p className="text-gray-600 max-w-xs mx-auto text-sm">
                                    {calculateScore() >= 8 ? "Bạn thực sự am hiểu về lịch sử nơi này." : 
                                     calculateScore() >= 5 ? "Bạn đã có kiến thức nền tảng khá tốt." : 
                                     "Hãy thử lại để khám phá thêm nhiều điều thú vị nhé."}
                                </p>
                            </div>

                            <div className="w-full max-w-xs space-y-2.5">
                                <button 
                                    onClick={() => generateQuiz(selectedLocation!)}
                                    className="w-full py-2.5 bg-indigo-600 text-white rounded-xl font-bold shadow-lg hover:bg-indigo-700 transition-all flex items-center justify-center gap-2 text-sm"
                                >
                                    <RefreshIcon className="w-4 h-4" /> Chơi lại bộ này
                                </button>
                                <button 
                                    onClick={resetQuiz}
                                    className="w-full py-2.5 bg-white text-gray-700 border border-gray-200 rounded-xl font-bold hover:bg-gray-50 transition-all text-sm"
                                >
                                    Chọn địa điểm khác
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
            <style>{`
                .custom-scrollbar::-webkit-scrollbar {
                    width: 4px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: transparent; 
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: rgba(0, 0, 0, 0.1); 
                    border-radius: 10px;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                    background: rgba(0, 0, 0, 0.2); 
                }
            `}</style>
        </div>
    );
};

export default QuizModal;
