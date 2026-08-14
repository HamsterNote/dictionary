import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Demo } from './Demo';
import '../../src/dictionary.css';
import './copyrightNoticeDownload.css';
import './featureOptions.css';
import './styles.css';
import './vocabularyPackPicker.css';

const rootElement = document.querySelector('#root');

if (!(rootElement instanceof HTMLElement)) {
  throw new Error('Demo root element was not found.');
}

createRoot(rootElement).render(
  <StrictMode>
    <Demo />
  </StrictMode>,
);
