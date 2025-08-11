import React, { useState } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography, TextField, CircularProgress, Box } from '@mui/material';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { GenerateMealDataRequestInput, MealGenerationDataResponse, MealGenerationDataResponseData } from '../shareable/meals';
import type { ErrorResponse } from '../shareable/response';
import { db, type Tag } from '../db/db';
// import { YOUTUBE_MOCK_DATA_1 } from '../mocks/youtube';

interface FromYoutubeMealCreationProps {
  open: boolean;
  onClose: () => void;
  onMealDataGenerated: (data: MealGenerationDataResponseData, youtubeUrl: string) => void;
}

const callYoutubeApi = async (input: GenerateMealDataRequestInput): Promise<MealGenerationDataResponse> => {
  const baseUrl = import.meta.env.VITE_YOUTUBE_API_BASE_URL || '';
  const response = await fetch(`${baseUrl}/youtube/generate-meal-data`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  let asJson: any;
  asJson = await response.json().catch((_error) => undefined);

  if (!response.ok) {
    let message: string;
    if (asJson) {
      const errorResponse = asJson as ErrorResponse;
      message = errorResponse.error;
    } else {
      message = 'Unexpected error. No JSON present in response';
    }
    throw new Error(`HTTP error status: ${response.status}${message ? `: ${message}` : ''}`);
  }

  return asJson;
};

const FromYoutubeMealCreation: React.FC<FromYoutubeMealCreationProps> = ({ open, onClose, onMealDataGenerated }) => {
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const { data: tags, isLoading: tagsLoading } = useQuery<Tag[]>({
    queryKey: ['tags'],
    queryFn: () => db.tags.toArray(),
  });

  const generateMealDataMutation = useMutation<MealGenerationDataResponse, Error, GenerateMealDataRequestInput>({
    mutationFn: async (input) => {
      return callYoutubeApi(input);
      // return YOUTUBE_MOCK_DATA_1;
    },
    onSuccess: (data) => {
      onClose();
      onMealDataGenerated(data as MealGenerationDataResponseData, youtubeUrl);
    },
  });

  const handleGenerateMealData = () => {
    generateMealDataMutation.mutate({
      url: youtubeUrl,
      pass: import.meta.env.VITE_YOUTUBE_API_PASS,
      availableTags: tags?.map((tag) => tag.name) ?? [],
    });
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Create Meal From YouTube Video</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          margin="dense"
          label="YouTube Video URL"
          type="url"
          fullWidth
          variant="outlined"
          value={youtubeUrl}
          onChange={(e) => setYoutubeUrl(e.target.value)}
        />
        <Button
          onClick={handleGenerateMealData}
          color="primary"
          variant="contained"
          disabled={generateMealDataMutation.isPending || tagsLoading || !youtubeUrl}
          sx={{ mt: 2 }}
        >
          {generateMealDataMutation.isPending ? <CircularProgress size={24} /> : 'Generate Meal Data'}
        </Button>

        {generateMealDataMutation.isError && (
          <Typography color="error" sx={{ mt: 2 }}>
            {generateMealDataMutation.error?.message}
          </Typography>
        )}

        {generateMealDataMutation.data && ('error' in generateMealDataMutation.data) && (
          <Typography color="error" sx={{ mt: 2 }}>
            API Error: {generateMealDataMutation.data.error}
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};

export default FromYoutubeMealCreation;
