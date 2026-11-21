import { createRootRoute, Link, Outlet, useNavigate } from '@tanstack/react-router';
import { AppBar, Toolbar, Typography, Container, Button, Box, IconButton } from '@mui/material';
import SettingsIcon from '@mui/icons-material/Settings';
import type React from 'react';
import { useEffect } from 'react';

const RootComponent: React.FC = () => {
  const navigate = useNavigate();

  useEffect(() => {
    if (window.location.pathname === '/index.html') {
      navigate({ to: '/', replace: true });
    }
  }, [navigate]);

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
          <Box sx={{display:{xs:'none',sm:'flex'}}}>
            <Button color="inherit" component={Link} to="/meals">Meals</Button>
            <Button color="inherit" component={Link} to="/grocery-list">Lists</Button>
            <Button color="inherit" component={Link} to="/manage-stores">Stores</Button>
            <Button color="inherit" component={Link} to="/restaurants">Restaurants</Button>
          </Box>
          <IconButton color="inherit" aria-label="Settings" onClick={() => navigate({to:'/settings'})}><SettingsIcon /></IconButton>
        </Toolbar>
        <Box component="nav" aria-label="Main navigation" sx={{display:{xs:'flex',sm:'none'},justifyContent:'space-around',pb:1}}>
          <Button color="inherit" component={Link} to="/meals">Meals</Button><Button color="inherit" component={Link} to="/grocery-list">Lists</Button><Button color="inherit" component={Link} to="/manage-stores">Stores</Button><Button color="inherit" component={Link} to="/restaurants">Restaurants</Button>
        </Box>
      </AppBar>
      <Toolbar /><Box sx={{height:{xs:44,sm:0}}} />
      <Container sx={{ mt: 2 }}>
        <Outlet />
      </Container>
    </>
  );
};

export const Route = createRootRoute({
  component: RootComponent,
});
