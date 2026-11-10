import text from '../examples/Welcome.md?raw';
import englishTemplate from '../examples/Welcome.en.md?raw';
import {APP_TITLE} from './brand.js';
import {currentUiLanguage} from './i18n.js';

// Return a fresh untitled document so opening the guide never overwrites a file.
export function welcomeDocument(){
  const english=currentUiLanguage()==='en';
  const image=text.match(/data:image\/png;base64,[A-Za-z0-9+/=]+/)?.[0]||'';
  const contents=english?englishTemplate.replace('{{WELCOME_IMAGE}}',image):text;
  return {name:APP_TITLE+(english?' Guide.md':' の使い方.md'),text:contents,savedText:contents,needsInitialSave:false};
}
