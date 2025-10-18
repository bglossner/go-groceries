import { useDroppable } from '@dnd-kit/core';
import { Paper, Typography } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';

const TrashCan = () => {
  const { setNodeRef, isOver } = useDroppable({
    id: 'trash-can',
  });

  return (
    <Paper
      ref={setNodeRef}
      sx={{
        p: 2,
        mb: 2,
        border: '2px dashed',
        borderColor: isOver ? 'error.main' : 'grey.400',
        backgroundColor: isOver ? 'error.light' : 'grey.100',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100px',
      }}
    >
      <DeleteIcon sx={{ fontSize: 40, color: isOver ? 'error.dark' : 'grey.600' }} />
      <Typography variant="h6" color={isOver ? 'error.dark' : 'grey.600'}>
        Drag ingredients here to remove from store
      </Typography>
    </Paper>
  );
};

export default TrashCan;
