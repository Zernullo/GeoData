/**
 * File upload input component with drag-and-drop support.
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
  file,
  preview,
  dragOver,
  onDragOver,
  onDragLeave,
  onDrop,
  onInputChange,
  inputRef,
}: UploadZoneProps) {
  return (
    <section className={dragOver ? 'upload-panel upload-panel-active' : 'upload-panel'}>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          onDragOver(event);
        }}
        onDragLeave={onDragLeave}
        onDrop={(event) => {
          event.preventDefault();
          onDrop(event);
        }}
        onClick={() => inputRef.current?.click()}
        className={preview ? 'upload-body upload-body-filled' : 'upload-body'}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          onChange={(event) => onInputChange(event.target.files)}
          style={{ display: 'none' }}
        />

        {preview ? (
          <>
            <div className="preview-frame">
              <img src={preview} alt="Selected upload preview" className="preview-image" />
            </div>
            <div className="upload-copy">
              <p className="label-text mb-2">Selected image</p>
              <h3 className="upload-title">{file?.name}</h3>
              <p className="upload-meta">
                {file ? `${(file.size / 1024).toFixed(1)} KB` : ''} - Click anywhere to replace the file
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="upload-plus-wrap" aria-hidden="true">
              <div className="upload-plus">+</div>
            </div>
            <div className="upload-copy upload-copy-center">
              <p className="label-text mb-2">Click to upload or drag and drop</p>
              <h3 className="upload-title">Build a privacy snapshot in seconds</h3>
              <p className="upload-meta">
                Add a JPG, PNG, TIFF, HEIC, or WEBP image. You will get a fast first result right away, and the deeper AI review can run after that.
              </p>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
