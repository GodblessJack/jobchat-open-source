import { useRef, useEffect, useState } from 'react';
import { Eraser, Undo, Trash2, Circle } from 'lucide-react';

export function Whiteboard() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [color, setColor] = useState('#2563eb');
  const [lineWidth, setLineWidth] = useState(3);
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');

  const colors = ['#2563eb', '#dc2626', '#16a34a', '#ea580c', '#9333ea', '#000000'];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 设置画布大小
    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    return () => window.removeEventListener('resize', resizeCanvas);
  }, []);

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    setIsDrawing(true);
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    ctx.strokeStyle = tool === 'eraser' ? '#FFFFFF' : color;
    ctx.lineWidth = tool === 'eraser' ? lineWidth * 3 : lineWidth;
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  return (
    <div className="w-full h-full flex flex-col">
      {/* 工具栏 */}
      <div className="h-16 bg-white/80 backdrop-blur-sm border-b border-gray-100 flex items-center px-8 gap-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setTool('pen')}
            className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${
              tool === 'pen'
                ? 'bg-blue-500 text-white shadow-md shadow-blue-200'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <Circle className="w-4 h-4" fill="currentColor" />
          </button>
          <button
            onClick={() => setTool('eraser')}
            className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${
              tool === 'eraser'
                ? 'bg-blue-500 text-white shadow-md shadow-blue-200'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <Eraser className="w-4 h-4" />
          </button>
        </div>

        <div className="w-px h-8 bg-gray-200" />

        <div className="flex items-center gap-3">
          {colors.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={`w-8 h-8 rounded-lg transition-all ${
                color === c ? 'ring-2 ring-blue-500 ring-offset-2 scale-110' : 'hover:scale-110'
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>

        <div className="w-px h-8 bg-gray-200" />

        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-600">Size</span>
          <input
            type="range"
            min="1"
            max="10"
            value={lineWidth}
            onChange={(e) => setLineWidth(Number(e.target.value))}
            className="w-32 accent-blue-500"
          />
          <span className="text-sm text-gray-500 w-8">{lineWidth}px</span>
        </div>

        <div className="flex-1" />

        <button
          onClick={clearCanvas}
          className="px-4 h-10 rounded-xl flex items-center gap-2 text-gray-600 hover:bg-red-50 hover:text-red-600 transition-all"
        >
          <Trash2 className="w-4 h-4" />
          <span>Clear Canvas</span>
        </button>
      </div>

      {/* 画布 */}
      <div className="flex-1 p-6">
        <canvas
          ref={canvasRef}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          className="w-full h-full border-2 border-gray-200 rounded-2xl cursor-crosshair bg-white shadow-lg"
        />
      </div>
    </div>
  );
}
