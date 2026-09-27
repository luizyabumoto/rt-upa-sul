import test from 'node:test';
import assert from 'node:assert/strict';
import {allowedEndpoint,dueItems,cuiabaClock} from '../supabase/functions/rt-push/logic.js';
test('push accepts only known secure services, rejects forged hosts and private URLs',()=>{
 for(const endpoint of ['http://web.push.apple.com/x','https://127.0.0.1/x','https://web.push.apple.com.evil.test/x','https://user@web.push.apple.com/x','https://web.push.apple.com:8443/x'])assert.equal(allowedEndpoint(endpoint),false);
 assert.equal(allowedEndpoint('https://web.push.apple.com/token'),true);
});
test('saved reminder wins over shift date; resolved tasks and notes do not notify',()=>{
 const items={'rt-upa:organizer':JSON.stringify([{kind:'task',date:'2026-10-03',reminder:'2026-09-27'},{kind:'task',date:'2026-09-20',status:'Resolvido'},{kind:'note',date:'2026-09-20'},{kind:'task',date:'2026-10-03'}])};
 assert.equal(dueItems(items,'2026-09-27').length,1);assert.deepEqual(dueItems({'rt-upa:organizer':'broken'},'2026-09-27'),[]);
});
test('Cuiaba midnight and eight oclock use local calendar',()=>{
 assert.deepEqual(cuiabaClock(new Date('2026-09-28T03:59:00Z')),{today:'2026-09-27',hour:23});
 assert.deepEqual(cuiabaClock(new Date('2026-09-28T12:00:00Z')),{today:'2026-09-28',hour:8});
});
