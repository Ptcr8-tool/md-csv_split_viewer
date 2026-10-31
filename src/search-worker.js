import {runSearch} from './search-core.js';
self.onmessage=e=>{try{self.postMessage({result:runSearch(e.data)});}catch(error){self.postMessage({error:error.message});}};
