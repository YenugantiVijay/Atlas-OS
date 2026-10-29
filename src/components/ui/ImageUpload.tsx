import React, { useRef, useState } from 'react';
import { Upload, X, Camera, AlertCircle } from 'lucide-react';

export interface ImageUploadProps {
  label?: string;
  value?: string;
  onChange: (value: string) => void;
  helperText?: string;
  shape?: 'circle' | 'square' | 'wide';
}

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB
const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export const ImageUpload: React.FC<ImageUploadProps> = ({
  label = 'Photo (Optional)',
  value,
  onChange,
  helperText = 'PNG, JPG, or WEBP up to 2MB',
  shape = 'square',
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const processAndResizeImage = (file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const src = event.target?.result as string;
      if (!src) return;

      const img = new Image();
      img.onload = () => {
        const maxDimension = shape === 'wide' ? 800 : 400;
        let width = img.width;
        let height = img.height;

        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const compressed = canvas.toDataURL('image/jpeg', 0.85);
          setError(null);
          onChange(compressed);
        } else {
          setError(null);
          onChange(src);
        }
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      setError('Invalid file format. Please upload PNG, JPG, or WEBP.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      setError('File size exceeds the 2MB limit.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    processAndResizeImage(file);
  };

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    setError(null);
    onChange('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const shapeStyles = {
    circle: 'w-20 h-20 rounded-full',
    square: 'w-24 h-24 rounded-xl',
    wide: 'w-full h-32 rounded-xl',
  };

  return (
    <div className="w-full space-y-1.5 text-left">
      {label && (
        <label className="block text-xs font-semibold text-content-primary">
          {label} <span className="text-[11px] text-content-muted font-normal">(Optional)</span>
        </label>
      )}

      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="image/png, image/jpeg, image/webp"
        className="hidden"
      />

      {error && (
        <div className="flex items-center gap-1.5 text-xs text-rose-600 bg-rose-50 border border-rose-200 px-2.5 py-1.5 rounded-lg animate-in fade-in">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {value ? (
        <div className="flex items-center gap-3.5">
          {/* Avatar / Photo Container */}
          <div className={`relative shrink-0 group ${shapeStyles[shape]}`}>
            {/* Inner clipped image frame */}
            <div
              className={`w-full h-full overflow-hidden border-2 border-atlas-200 bg-surface-panel shadow-sm ${
                shape === 'circle' ? 'rounded-full' : 'rounded-xl'
              }`}
            >
              <img src={value} alt="Preview" className="w-full h-full object-cover" />
            </div>

            {/* Remove / Delete Cross Button: Explicit z-index, positioned cleanly on top-right, unclipped with white border and shadow */}
            <button
              type="button"
              onClick={handleRemove}
              className={`absolute z-30 flex items-center justify-center rounded-full bg-red-600 text-white hover:bg-red-700 shadow-md border-2 border-white ring-1 ring-black/10 transition-all hover:scale-110 active:scale-95 cursor-pointer ${
                shape === 'circle' ? 'top-0 right-0 w-6 h-6' : '-top-1.5 -right-1.5 w-6 h-6'
              }`}
              title="Remove photo"
              aria-label="Remove photo"
            >
              <X className="w-3.5 h-3.5 stroke-[2.5]" />
            </button>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-3 py-1.5 rounded-lg border border-border bg-surface-card hover:bg-atlas-50 hover:border-atlas-300 text-xs font-semibold text-content-primary transition-colors inline-flex items-center gap-1.5 shadow-xs"
              >
                <Camera className="w-3.5 h-3.5 text-atlas-600" />
                <span>Change Photo</span>
              </button>

              <button
                type="button"
                onClick={handleRemove}
                className="px-2.5 py-1.5 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-xs font-semibold text-red-700 transition-colors inline-flex items-center gap-1 shadow-xs"
              >
                <X className="w-3.5 h-3.5" />
                <span>Remove</span>
              </button>
            </div>
            <p className="text-[11px] text-content-muted">{helperText}</p>
          </div>
        </div>
      ) : (
        <div
          onClick={() => fileInputRef.current?.click()}
          className="flex flex-col items-center justify-center p-3.5 rounded-xl border-2 border-dashed border-border bg-surface-panel/60 hover:bg-atlas-50/50 hover:border-atlas-300 transition-all cursor-pointer group"
        >
          <div className="w-8 h-8 rounded-lg bg-atlas-100 text-atlas-600 flex items-center justify-center mb-1 group-hover:scale-105 transition-transform shadow-xs">
            <Upload className="w-4 h-4" />
          </div>
          <div className="text-xs font-semibold text-content-primary group-hover:text-atlas-800">
            Click to upload photo
          </div>
          <p className="text-[10px] text-content-muted mt-0.5">{helperText}</p>
        </div>
      )}
    </div>
  );
};
