/**
 * @fileoverview File upload input component with drag-and-drop support.
 */

interface UploadZoneProps {
  file: File | null;
  preview: string | null;
  dragOver: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onInputChange: (files: FileList | null) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}

export function UploadZone({
  file, preview, dragOver, onDragOver, onDragLeave, onDrop, onInputChange, inputRef
}: UploadZoneProps) {
  return (
    <div className={`card ${dragOver ? 'card-accent' : ''}`} style={{
      borderColor: dragOver ? 'var(--green)' : 'var(--border)',
      background: dragOver ? 'var(--green-dim)' : 'var(--surface)',
    }}>
      <div
        onDragOver={(e) => { e.preventDefault(); onDragOver(e); }}
        onDragLeave={onDragLeave}
        onDrop={(e) => { e.preventDefault(); onDrop(e); }}
        onClick={() => inputRef.current?.click()}
        className={`cursor-pointer flex ${preview ? 'flex-row items-center' : 'flex-col items-center justify-center'} gap-6 ${preview ? 'p-6' : 'p-12'}`}
      >
        <input ref={inputRef} type="file" accept="image/*"
          onChange={(e) => onInputChange(e.target.files)} style={{ display: 'none' }} />

        {preview ? (
          <>
            <img src={preview} alt="preview" className="w-20 h-20 object-cover rounded-sm border border-dark-border-accent shrink-0" />
            <div>
              <p className="label-text mb-1">TARGET ACQUIRED</p>
              <p className="text-dark-text text-sm mb-1">{file?.name}</p>
              <p className="text-dark-muted text-xs">
                {file ? `${(file.size / 1024).toFixed(1)} KB` : ''} — click to change
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="w-12 h-12 border border-dark-border-accent rounded flex items-center justify-center text-2xl">⊕</div>
            <div className="text-center">
              <p className="label-text mb-2">DROP IMAGE FILE</p>
              <p className="text-dark-muted text-xs">JPG · PNG · TIFF · HEIC · WEBP</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
