import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { db, type Store } from '../db/db';
import { Paper, Typography, TextField, Button, Box } from '@mui/material';

const CreateStoreForm = () => {
  const [name, setName] = useState('');
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (newStore: Omit<Store, 'id'>) => db.stores.add(newStore),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stores'] });
      setName('');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      mutation.mutate({ name: name.trim() });
    }
  };

  return (
    <Paper sx={{ p: 2, mb: 2 }}>
      <Typography variant="h6">Create New Store</Typography>
      <Box component="form" onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
        <TextField
          label="Store Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          variant="outlined"
          size="small"
          fullWidth
        />
        <Button type="submit" variant="contained">Create</Button>
      </Box>
    </Paper>
  );
};

export default CreateStoreForm;
