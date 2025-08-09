import { createRootRoute, Link, Outlet, useNavigate } from '@tanstack/react-router';
import { AppBar, Toolbar, Typography, Container, Button, Box, IconButton } from '@mui/material';
import SettingsIcon from '@mui/icons-material/Settings';

export const Route = createRootRoute({
  component: () => {
    const navigate = useNavigate();
    return (
      <>
        <AppBar position="fixed">
          <Toolbar>
            <Typography variant="h6" component="div" sx={{ textAlign: 'left' }}>
              <Link to="/" style={{ textDecoration: 'none', color: 'inherit' }}>
                Go Groceries
              </Link>
            </Typography>
            <Box sx={{ flexGrow: 1 }} />
            <Button color="inherit" component={Link} to="/meals">
              Meals
            </Button>
            <Button color="inherit" component={Link} to="/grocery-list">
              Grocery List
            </Button>
            <IconButton color="inherit" onClick={() => navigate({ to: '/settings' })}>
              <SettingsIcon />
            </IconButton>
          </Toolbar>
        </AppBar>
        <Toolbar />
        <Container sx={{ mt: 2 }}>
          <Outlet />
        </Container>
      </>
    );
  },
});