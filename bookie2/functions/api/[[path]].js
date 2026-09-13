import {handle} from '../../server/api.mjs';
export const onRequest = ({request,env})=>handle(request,env);
