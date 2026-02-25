import React, { useState, useRef, useEffect } from 'react';
import { Mic, MicOff, X } from 'lucide-react';
import Button from '../Common/Button';

export default function VoiceWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [response, setResponse] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (isListening && canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      let frame = 0;
      const animate = () => {
        if (!isListening) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = '#2563eb';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let x = 0; x < canvas.width; x++) {
          const y = canvas.height / 2 + Math.sin(x * 0.02 + frame * 0.1) * 20 * Math.random();
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        frame++;
        requestAnimationFrame(animate);
      };
      animate();
    }
  }, [isListening]);

  const startListening = () => {
    setIsListening(true);
    setTranscript('');
    setResponse('');
    setTimeout(() => {
      setTranscript('मुझे मुद्रा लोन के बारे में जानकारी चाहिए');
      setIsListening(false);
      setTimeout(() => {
        setResponse(
          'मुद्रा लोन तीन प्रकार का है - शिशु (₹50,000 तक), किशोर (₹50,000-₹5 लाख), और तरुण (₹5-₹10 लाख)। आप किस प्रकार के लोन में रुचि रखते हैं?'
        );
      }, 1000);
    }, 3000);
  };

  const stopListening = () => setIsListening(false);

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 w-16 h-16 bg-primary-600 text-white rounded-full shadow-lg hover:bg-primary-700 transition-all hover:scale-110 flex items-center justify-center z-50"
        aria-label="Open voice assistant"
      >
        <Mic className="w-6 h-6" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 w-96 bg-white rounded-lg shadow-2xl z-50 overflow-hidden border border-gray-200">
      <div className="bg-primary-600 text-white p-4 flex items-center justify-between">
        <h3 className="font-semibold">VaaniSetu Voice Assistant</h3>
        <button onClick={() => setIsOpen(false)} className="hover:bg-primary-700 p-1 rounded" aria-label="Close">
          <X className="w-5 h-5" />
        </button>
      </div>
      {isListening && (
        <div className="bg-blue-50 p-4">
          <canvas ref={canvasRef} width={352} height={80} className="w-full" />
        </div>
      )}
      <div className="p-4 space-y-4 max-h-96 overflow-y-auto">
        {transcript && (
          <div className="bg-gray-100 p-3 rounded-lg">
            <p className="text-sm text-gray-600 mb-1">You said:</p>
            <p className="text-gray-900">{transcript}</p>
          </div>
        )}
        {response && (
          <div className="bg-primary-50 p-3 rounded-lg">
            <p className="text-sm text-primary-600 mb-1">VaaniSetu:</p>
            <p className="text-gray-900">{response}</p>
          </div>
        )}
      </div>
      <div className="p-4 border-t border-gray-200">
        <div className="flex items-center justify-center gap-4">
          {!isListening ? (
            <Button onClick={startListening} className="w-full flex items-center justify-center gap-2">
              <Mic className="w-5 h-5" />
              Start Speaking
            </Button>
          ) : (
            <Button onClick={stopListening} variant="outline" className="w-full flex items-center justify-center gap-2">
              <MicOff className="w-5 h-5" />
              Stop
            </Button>
          )}
        </div>
        <p className="text-xs text-center text-gray-500 mt-2">Speak in Hindi, Tamil, or Telugu</p>
      </div>
    </div>
  );
}
