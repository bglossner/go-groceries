import React, { useState } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography, TextField, CircularProgress, Box, FormControlLabel, Checkbox } from '@mui/material';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { GenerateMealDataRequestInput, MealGenerationDataInput, MealGenerationDataResponse } from '../shareable/meals';
import type { ErrorResponse } from '../shareable/response';
import { db, type Tag, type Setting } from '../db/db';
// @ts-ignore
import { YOUTUBE_MOCK_DATA_1 } from '../mocks/youtube';

interface FromYoutubeMealCreationProps {
  open: boolean;
  onClose: () => void;
  onMealDataGenerated: (data: MealGenerationDataInput, youtubeUrl: string, createRecipe: boolean) => void;
}

// @ts-ignore
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
  const [createRecipe, setCreateRecipe] = useState(false);
  const { data: tags, isLoading: tagsLoading } = useQuery<Tag[]>({
    queryKey: ['tags'],
    queryFn: () => db.tags.toArray(),
  });

  const { data: youtubeApiPassSetting } = useQuery<Setting | undefined>({
    queryKey: ['settings', 'youtubeApiPass'],
    queryFn: () => db.settings.get('youtubeApiPass'),
  });

  const generateMealDataMutation = useMutation<MealGenerationDataResponse, Error, GenerateMealDataRequestInput>({
    // @ts-ignore
    mutationFn: async (input) => {
      // @ts-ignore
      return callYoutubeApi(input);
      // return YOUTUBE_MOCK_DATA_1;
    },
    onSuccess: (data) => {
      if ('error' in data) throw new Error('API Error. How did we get this far? ' + data.error);

      onClose();
      onMealDataGenerated(data.data, youtubeUrl, createRecipe);
    },
  });

  console.log(youtubeApiPassSetting?.value);
  const handleGenerateMealData = () => {
    const pass = youtubeApiPassSetting?.value || import.meta.env.VITE_YOUTUBE_API_PASS;
    generateMealDataMutation.mutate({
      url: youtubeUrl,
      pass: pass,
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
        <FormControlLabel
          control={<Checkbox checked={createRecipe} onChange={(e) => setCreateRecipe(e.target.checked)} />}
          label="Automagically import recipe"
          sx={{ mt: 1 }}
        />
        <Box sx={{ mt: 2 }}>
          <Button
            onClick={handleGenerateMealData}
            color="primary"
            variant="contained"
            disabled={generateMealDataMutation.isPending || tagsLoading || !youtubeUrl}
          >
            {generateMealDataMutation.isPending ? <CircularProgress size={24} /> : 'Generate Meal Data'}
          </Button>
        </Box>

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
