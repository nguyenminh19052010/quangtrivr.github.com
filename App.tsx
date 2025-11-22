
import React, { useState, useCallback } from 'react';
import Chatbot from './components/Chatbot';
import QuizModal from './components/QuizModal';
import { ChatIcon, VrIcon, QuizIcon } from './components/icons';

const PermissionErrorModal: React.FC<{ onClose: () => void }> = ({ onClose }) => (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[100] flex justify-center items-center" aria-modal="true" role="dialog">
        <div className="bg-white/90 backdrop-blur-xl rounded-2xl shadow-2xl p-8 max-w-md w-full mx-4 text-center transform transition-all duration-300 ease-in-out scale-100 border border-white/50">
            <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-red-100 mb-6">
                <svg className="h-8 w-8 text-red-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">
                Quyền Truy Cập Bị Từ Chối
            </h3>
            <div className="space-y-3">
                <p className="text-gray-600">
                    Bạn đã từ chối quyền chia sẻ màn hình. Tính năng "Chụp Khung Cảnh" cần quyền này để phân tích và cung cấp thông tin về địa điểm bạn đang xem.
                </p>
                <p className="text-gray-600">
                    Để có trải nghiệm tốt nhất, vui lòng chọn chia sẻ <strong>Toàn bộ màn hình</strong> trong hộp thoại của trình duyệt.
                </p>
            </div>
            <div className="mt-8">
                <button
                    type="button"
                    className="w-full rounded-xl shadow-lg shadow-blue-500/30 px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-base font-semibold text-white hover:from-blue-700 hover:to-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-all transform hover:scale-[1.02]"
                    onClick={onClose}
                >
                    Đã hiểu
                </button>
            </div>
        </div>
    </div>
);

export type VrAssistantState = 'idle' | 'listening' | 'active' | 'processing';

const App: React.FC = () => {
    const [isChatOpen, setIsChatOpen] = useState(false);
    const [isQuizOpen, setIsQuizOpen] = useState(false);
    const [capturedImage, setCapturedImage] = useState<{ data: string; mimeType: string; } | null>(null);
    const [captureError, setCaptureError] = useState<string | null>(null);
    const [isVrMode, setIsVrMode] = useState(false);
    const [vrAssistantState, setVrAssistantState] = useState<VrAssistantState>('idle');
    const [showPermissionModal, setShowPermissionModal] = useState(false);


    const handleCapture = useCallback(async () => {
        setCaptureError(null);
        if (!('ImageCapture' in window)) {
            const errorMessage = "Tính năng chụp màn hình không được trình duyệt này hỗ trợ. Vui lòng thử trên trình duyệt Chrome hoặc Edge mới nhất.";
            setCaptureError(errorMessage);
            setTimeout(() => setCaptureError(null), 7000);
            return;
        }

        let stream: MediaStream | undefined;
        let captureSucceeded = false;
        try {
            stream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    displaySurface: 'monitor'
                },
                audio: false,
            });
            const track = stream.getVideoTracks()[0];
            const imageCapture = new (window as any).ImageCapture(track);
            const bitmap = await imageCapture.grabFrame();
            
            const canvas = document.createElement('canvas');
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const context = canvas.getContext('2d');
            if (context) {
                context.drawImage(bitmap, 0, 0);
                const dataUrl = canvas.toDataURL('image/jpeg');
                
                const parts = dataUrl.split(',');
                const mimeTypePart = parts[0].match(/:(.*?);/);

                if (parts.length === 2 && mimeTypePart) {
                    const mimeType = mimeTypePart[1];
                    const data = parts[1];
                    setCapturedImage({ data, mimeType });
                    setIsChatOpen(true);
                    captureSucceeded = true;
                }
            }
        } catch (error: any) {
            console.error("Error capturing screen:", error);
            if (error.name === 'NotAllowedError') {
                setShowPermissionModal(true);
            } else {
                 let errorMessage = "Đã xảy ra lỗi khi chụp màn hình. Vui lòng thử lại.";
                 setCaptureError(errorMessage);
                 setTimeout(() => setCaptureError(null), 7000);
            }
        } finally {
            stream?.getTracks().forEach(track => track.stop());

            if (captureSucceeded && document.fullscreenElement === null) {
                document.documentElement.requestFullscreen().catch(err => {
                    console.warn("Could not automatically re-enter fullscreen:", err);
                });
            }
        }
    }, []);
    
    const toggleVrMode = () => {
        setIsVrMode(prev => !prev);
    };

    const handleDeactivateVrMode = useCallback(() => {
        setIsVrMode(false);
    }, []);

    // Base classes for buttons
    const buttonBaseClasses = "rounded-full p-4 shadow-lg backdrop-blur-sm border border-white/20 text-white transition-all duration-300 ease-in-out transform hover:scale-110 focus:outline-none focus:ring-4";
    
    let vrButtonClasses = buttonBaseClasses;

    if (isVrMode) {
        if (vrAssistantState === 'active') {
             vrButtonClasses += ' bg-gradient-to-r from-yellow-400 to-orange-500 hover:from-yellow-500 hover:to-orange-600 focus:ring-yellow-300 animate-pulse shadow-yellow-500/50';
        } else if (vrAssistantState === 'listening') {
            vrButtonClasses += ' bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 focus:ring-green-400 shadow-green-500/50';
        } else if (vrAssistantState === 'processing') {
            vrButtonClasses += ' bg-gradient-to-r from-blue-500 to-cyan-600 hover:from-blue-600 hover:to-cyan-700 focus:ring-blue-400 animate-pulse shadow-blue-500/50';
        } else {
            vrButtonClasses += ' bg-gray-800/80 hover:bg-gray-800 focus:ring-gray-500';
        }
    } else {
        vrButtonClasses += ' bg-gray-800/80 hover:bg-gray-800 focus:ring-gray-500';
    }


    return (
        <div className="relative w-screen h-screen bg-black overflow-hidden">
            {showPermissionModal && <PermissionErrorModal onClose={() => setShowPermissionModal(false)} />}
            
            {/* Overlay Gradient for better text visibility if needed, though VR usually handles it */}
            
            <iframe
                src="https://vr360.quangtri.gov.vn/"
                title="Quang Tri Virtual Tour"
                className="absolute inset-0 w-full h-full border-0"
                allowFullScreen
            ></iframe>

            <div className="fixed bottom-6 right-6 z-40 flex flex-col items-center gap-4">
                 {captureError && (
                    <div className="bg-red-100/90 backdrop-blur-md border border-red-400 text-red-700 px-4 py-3 rounded-xl relative max-w-xs text-center mb-2 shadow-xl animate-fade-in-up" role="alert">
                        <span className="block sm:inline text-sm font-medium">{captureError}</span>
                    </div>
                 )}
                 
                 {/* Quiz Button */}
                 <button
                    onClick={() => setIsQuizOpen(true)}
                    className="rounded-full p-4 shadow-lg shadow-purple-600/40 border border-white/20 text-white transition-all duration-300 ease-in-out transform hover:scale-110 focus:outline-none focus:ring-4 focus:ring-purple-400 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
                    aria-label="Open History Quiz"
                    title="Thử tài lịch sử"
                 >
                    <QuizIcon />
                 </button>

                 <button
                    onClick={toggleVrMode}
                    className={vrButtonClasses}
                    aria-label={isVrMode ? "Deactivate VR Voice Mode" : "Activate VR Voice Mode"}
                    title="Chế độ rảnh tay"
                 >
                    <VrIcon />
                 </button>
                 
                <button
                    onClick={() => setIsChatOpen(!isChatOpen)}
                    className={`rounded-full p-4 shadow-lg shadow-blue-600/40 border border-white/20 text-white transition-all duration-300 ease-in-out transform hover:scale-110 focus:outline-none focus:ring-4 focus:ring-blue-400
                    ${isChatOpen 
                        ? 'bg-white text-blue-600 rotate-90' 
                        : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700'}`}
                    aria-label="Toggle Chat"
                    title="Chat với AI"
                >
                    {isChatOpen ? (
                         <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    ) : (
                        <ChatIcon />
                    )}
                </button>
            </div>
            
            <Chatbot 
                isOpen={isChatOpen}
                onClose={() => setIsChatOpen(false)} 
                capturedImage={capturedImage}
                onCaptureHandled={() => setCapturedImage(null)}
                isVrMode={isVrMode}
                onDeactivateVrMode={handleDeactivateVrMode}
                vrAssistantState={vrAssistantState}
                setVrAssistantState={setVrAssistantState}
                onTriggerCapture={handleCapture}
            />

            <QuizModal 
                isOpen={isQuizOpen} 
                onClose={() => setIsQuizOpen(false)} 
            />
            
            <style>{`
                @keyframes fade-in-up {
                    from { opacity: 0; transform: translateY(10px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                .animate-fade-in-up {
                    animation: fade-in-up 0.3s ease-out forwards;
                }
            `}</style>
        </div>
    );
};

export default App;
