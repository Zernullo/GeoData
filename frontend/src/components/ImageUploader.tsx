import React, { useState } from 'react';

interface ExifData {
  Make?: string;
  Model?: string;
  DateTime?: string;
  Software?: string;
  GPS?: {
        lat: number;
        lon: number;
    };
  [key: string]: unknown;
}

export default function ImageUploader() {
    const [file, setFile] = useState<File | null>(null);
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<ExifData | null>(null);
    const [error, setError] = useState<string | null>(null);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
        setFile(e.target.files[0]);
        }
    };

    const handleUpload = async () => {
        if (!file) {
        setError('Please select an image');
        return;
        }

        setLoading(true);
        setError(null);
        setResult(null);

        try {
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch('http://localhost:8000/api/extract-exif-json', {
            method: 'POST',
            body: formData,
        });

        const data = await response.json();

        if (data.success) {
            setResult(data.data.exif_data); // ← drill into exif_data
            console.log(data.data.exif_data);
        } else {
            setError(data.error || 'Failed to extract EXIF data');
        }
        } catch (err) {
        setError(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
        } finally {
        setLoading(false);
        }
    };

    return (
        <div className="p-6 max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">GeoData - Image Analysis</h1>

        <div className="space-y-4">
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-6">
            <input
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="block w-full"
            />
            </div>

            <button
            onClick={handleUpload}
            disabled={!file || loading}
            className="w-full bg-blue-500 text-white py-2 px-4 rounded hover:bg-blue-600 disabled:bg-gray-400"
            >
            {loading ? 'Analyzing...' : 'Upload & Analyze'}
            </button>

            {error && (
            <div className="bg-red-100 text-red-700 p-4 rounded">{error}</div>
            )}

            {result && (
            <div className="bg-gray-50 p-4 rounded">
                <h2 className="text-xl font-bold mb-4">EXIF Data</h2>

                <div className="space-y-2">
                {result.Make && (
                    <p><strong>Camera Make:</strong> {result.Make}</p>
                )}
                {result.Model && (
                    <p><strong>Camera Model:</strong> {result.Model}</p>
                )}
                {result.DateTime && (
                    <p><strong>DateTime:</strong> {result.DateTime}</p>
                )}
                {result.Software && (
                    <p><strong>Software:</strong> {result.Software}</p>
                )}
                {result.GPS && (
                    <div>
                    <strong>GPS Location:</strong>
                    <p className="ml-4">Latitude: {result.GPS.lat}</p>
                    <p className="ml-4">Longitude: {result.GPS.lon}</p>
                    </div>
                )}
                </div>

                <pre className="mt-4 bg-white p-2 rounded text-sm overflow-auto max-h-64">
                {JSON.stringify(result, null, 2)}
                </pre>
            </div>
            )}
        </div>
        </div>
    );
}
