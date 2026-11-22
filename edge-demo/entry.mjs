import worker from './worker.mjs';
import vazirFont from './Vazirmatn.woff2';
export default {fetch(request,env,ctx){return worker.fetch(request,{...env,VAZIR_FONT:vazirFont},ctx);}};
