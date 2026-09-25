/**
 * Client-side transfer utilities
 * Calls server-side API endpoints for transfer operations
 */

import type { TransferOptions, TransferProgress } from "./transfer-types";

export interface TransferApiRequest {
  sourceConnectionString: string;
  sourceProvider: string;
  destinationConnectionString: string;
  destinationProvider: string;
  options: TransferOptions;
}

export interface TransferApiResponse {
  success: boolean;
  error?: string;
  stats?: Record<string, number>;
}

const API_BASE = typeof window !== 'undefined' && window.location 
  ? `${window.location.protocol}//${window.location.host}` 
  : 'http://localhost:3000';

export async function startTransfer(
  request: TransferApiRequest,
  onProgress?: (progress: TransferProgress) => void
): Promise<TransferApiResponse> {
  try {
    const response = await fetch(`${API_BASE}/api/transfer/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.text();
      return { success: false, error };
    }

    const result = await response.json();
    
    // If we have a transfer ID, we can poll for progress
    if (result.transferId && onProgress) {
      await pollTransferProgress(result.transferId, onProgress);
    }

    return result;
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Transfer failed' 
    };
  }
}

async function pollTransferProgress(
  transferId: string,
  onProgress: (progress: TransferProgress) => void
): Promise<void> {
  const pollInterval = setInterval(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/transfer/progress/${transferId}`);
      if (response.ok) {
        const progress = await response.json();
        onProgress(progress);
        
        if (progress.currentStep === 'complete' || progress.error) {
          clearInterval(pollInterval);
        }
      }
    } catch (error) {
      console.error('Progress polling error:', error);
      clearInterval(pollInterval);
    }
  }, 1000);

  // Stop polling after 5 minutes
  setTimeout(() => clearInterval(pollInterval), 5 * 60 * 1000);
}