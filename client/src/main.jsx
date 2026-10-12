import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './styles/base.css'
import './styles/shell.css'
import './styles/views.css'
import './styles/study.css'
import { AuthProvider } from './lib/AuthContext.jsx'
import { watchSystemTheme } from './lib/theme.js'
import App from './App.jsx'

watchSystemTheme();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
