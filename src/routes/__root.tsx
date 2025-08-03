import { createRootRoute, Link, Outlet } from '@tanstack/react-router';
import { AppBar, Toolbar, Typography, Container, Button, Box } from '@mui/material';

export const Route = createRootRoute({
  component: () => (
    <>
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" component="div" sx={{ textAlign: 'left' }}>
            <Link to="/" style={{ textDecoration: 'none', color: 'inherit' }}>
              Go Groceries
            </Link>
          </Typography>
          <Box sx={{ flexGrow: 1 }} />
          <Button color="inherit" component={Link} to="/">
            Home
          </Button>
          <Button color="inherit" component={Link} to="/meals">
            Meals
          </Button>
          <Button color="inherit" component={Link} to="/grocery-list">
            Grocery List
          </Button>
        </Toolbar>
      </AppBar>
      <Container sx={{ mt: 2 }}>
        <Outlet />
      </Container>
    </>
  ),
});