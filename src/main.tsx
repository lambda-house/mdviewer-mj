import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { useStore } from './store';
import './styles/index.css';

// Apply the persisted theme before the first paint (no dark flash in light
// mode), and follow later changes
const applyTheme = (theme: string) => {
  document.documentElement.dataset.theme = theme;
};
applyTheme(useStore.getState().theme);
useStore.subscribe((state, prev) => {
  if (state.theme !== prev.theme) applyTheme(state.theme);
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
