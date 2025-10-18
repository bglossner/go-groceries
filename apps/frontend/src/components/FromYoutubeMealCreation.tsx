import React, { useMemo, useState } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography, TextField, CircularProgress, Box, FormControlLabel, Checkbox, FormControl, InputLabel, Select, MenuItem } from '@mui/material';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { GenerateMealDataYoutubeRequestInput, MealGenerationDataInput, MealGenerationDataResponse, GroqModelName, ModelSelection } from '../shareable/meals';
import type { ErrorResponse } from '../shareable/response';
import { db, type Tag, type Setting } from '../db/db';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { YOUTUBE_MOCK_DATA_1 } from '../mocks/youtube';

interface FromYoutubeMealCreationProps {
  open: boolean;
  onClose: () => void;
  onMealDataGenerated: (data: MealGenerationDataInput, youtubeUrl: string, createRecipe: boolean) => void;
}

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
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

  const asJson: MealGenerationDataResponse | ErrorResponse = await response.json().catch((_error) => undefined);

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

const modelOptionsByClient = {
  Groq: [
    { label: 'moonshotai/kimi-k2-instruct-0905', value: 'moonshotai/kimi-k2-instruct-0905' },
    { label: 'moonshotai/kimi-k2-instruct', value: 'moonshotai/kimi-k2-instruct' },
    { label: 'llama-3.3-70b-versatile', value: 'llama-3.3-70b-versatile' },
    { label: 'openai/gpt-oss-120b', value: 'openai/gpt-oss-120b' },
    { label: 'llama3-70b-8192', value: 'llama3-70b-8192' },
    { label: 'gemma2-9b-it', value: 'gemma2-9b-it' },
    { label: 'llama3-8b-8192', value: 'llama3-8b-8192' },
  ],
} as const satisfies Record<ModelSelection['client'], { label: string; value: GroqModelName }[]>;

const FromYoutubeMealCreation: React.FC<FromYoutubeMealCreationProps> = ({ open, onClose, onMealDataGenerated }) => {
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [createRecipe, setCreateRecipe] = useState(false);
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
  const [logModelResponse, setLogModelResponse] = useState(false);
  const [logModelRequestInput, setLogModelRequestInput] = useState(false);
  const [logYouTubeResponse, setLogYouTubeResponse] = useState(false);
  const [selectedClient, setSelectedClient] = useState<'Groq' | ''>('');
  const [selectedModel, setSelectedModel] = useState<GroqModelName | ''>('');
  const [skipAnyCaching, setSkipAnyCaching] = useState(false);
  const { data: tags, isLoading: tagsLoading } = useQuery<Tag[]>({
    queryKey: ['tags'],
    queryFn: () => db.tags.toArray(),
  });

  const { data: youtubeApiPassSetting } = useQuery<Setting | undefined>({
    queryKey: ['settings', 'youtubeApiPass'],
    queryFn: () => db.settings.get('youtubeApiPass'),
  });

  const generateMealDataMutation = useMutation<MealGenerationDataResponse, Error, GenerateMealDataYoutubeRequestInput>({
    mutationFn: async (input) => {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
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

  const handleGenerateMealData = () => {
    const pass = youtubeApiPassSetting?.value || import.meta.env.VITE_YOUTUBE_API_PASS;

    const additionalInput = {
      type: 'youtube' as const,
      ...(logModelResponse && { logModelResponse: true }),
      ...(logModelRequestInput && { logModelRequestInput: true }),
      ...(logYouTubeResponse && { logYouTubeResponse: true }),
      ...(skipAnyCaching && { skipAnyCaching: true }),
      ...(selectedClient && { modelSelection: { client: selectedClient, ...(selectedModel && { model: selectedModel }) } }),
    };

    generateMealDataMutation.mutate({
      url: youtubeUrl,
      pass: pass,
      availableTags: tags?.map((tag) => tag.name) ?? [],
      additionalInput: additionalInput,
    });
  };

  const modelOptions = useMemo(() => !selectedClient ? [] : modelOptionsByClient[selectedClient], [selectedClient]);

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
          sx={{ mt: 1, mb: 2 }}
        />
        <Button onClick={() => setShowAdvancedOptions(prev => !prev)} size="small" sx={{ mb: 2, display: 'block' }}>
          {showAdvancedOptions ? 'Hide Advanced Options' : 'Show Advanced Options'}
        </Button>

        {showAdvancedOptions && (
          <Box sx={{ mt: 2, border: '1px solid #ccc', p: 2, borderRadius: '4px' }}>
            <Typography variant="subtitle1" gutterBottom>Advanced Options</Typography>
            <FormControlLabel
              control={<Checkbox checked={logModelResponse} onChange={(e) => setLogModelResponse(e.target.checked)} />}
              label="Log Model Response"
            />
            <FormControlLabel
              control={<Checkbox checked={logModelRequestInput} onChange={(e) => setLogModelRequestInput(e.target.checked)} />}
              label="Log Model Request Input"
            />
            <FormControlLabel
              control={<Checkbox checked={logYouTubeResponse} onChange={(e) => setLogYouTubeResponse(e.target.checked)} />}
              label="Log YouTube Response"
            />
            <FormControlLabel
              control={<Checkbox checked={skipAnyCaching} onChange={(e) => setSkipAnyCaching(e.target.checked)} />}
              label="Skip Any Caching"
            />

            <Typography variant="subtitle1" sx={{ mt: 2 }} gutterBottom>Model Selection</Typography>
            <FormControl fullWidth margin="dense">
              <InputLabel id="client-select-label">Client</InputLabel>
              <Select
                labelId="client-select-label"
                value={selectedClient}
                label="Client"
                onChange={(e) => {
                  setSelectedClient(e.target.value);
                  setSelectedModel(''); // Reset model when client changes
                }}
              >
                <MenuItem value="Groq">Groq</MenuItem>
                <MenuItem value="">None</MenuItem>
              </Select>
            </FormControl>

            <FormControl fullWidth margin="dense" disabled={!selectedClient}>
              <InputLabel id="model-select-label">Model Name</InputLabel>
              <Select
                labelId="model-select-label"
                value={selectedModel}
                label="Model"
                onChange={(e) => { console.log(e); setSelectedModel(e.target.value)}}
              >
                {modelOptions.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
                <MenuItem value="">None</MenuItem>
              </Select>
            </FormControl>
          </Box>
        )}
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
