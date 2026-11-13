/* Shared password identity + private cloud transport. Business data stays out of browser storage. */
(function (root) {
  'use strict';
  const MAX_IMAGE = 12 * 1024 * 1024;
  const MAX_DATA = 1024 * 1024;
  const APP_ERROR = Symbol('xunxu-cloud-error');
  function failure(message, code, status) {
    return Object.assign(new Error(message), {code, status, [APP_ERROR]: true});
  }
  function validateConfig(input) {
    const config = input || {}, key = String(config.supabasePublishableKey || '').trim();
    const sharedLoginEmail = String(config.sharedLoginEmail || '').trim().toLowerCase();
    let url;
    try {
      url = new URL(String(config.supabaseUrl || '').trim());
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !/^\/?$/.test(url.pathname)) throw new Error();
    } catch { return {configured: false, emailLoginEnabled: false, sharedLoginEmail: '', passwordLoginEnabled: false}; }
    if (!/^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(key)) return {configured: false, emailLoginEnabled: false, sharedLoginEmail: '', passwordLoginEnabled: false};
    const validSharedLoginEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sharedLoginEmail);
    return {configured: true, url: url.origin, key, emailLoginEnabled: config.emailLoginEnabled === true,
      sharedLoginEmail: validSharedLoginEmail ? sharedLoginEmail : '', passwordLoginEnabled: config.passwordLoginEnabled === true && validSharedLoginEmail};
  }
  function normalizeUser(user) {
    if (!user || typeof user.id !== 'string' || !user.id || user.is_anonymous === true || !user.email || !user.email_confirmed_at) return null;
    return {id: user.id, email: user.email, displayName: user.email};
  }
  function mapError(source) {
    if (source?.[APP_ERROR]) return source;
    const original = source || {}, sqlCode = String(original.code || '');
    let details = {};
    try { details = typeof original.details === 'string' ? JSON.parse(original.details) : original.details || {}; } catch {}
    let status = /^PT\d{3}$/.test(sqlCode) ? Number(sqlCode.slice(2)) : Number(original.status || original.statusCode || 0);
    const code = details.code || sqlCode;
    if (['invalid_credentials', 'invalid_grant'].includes(code)) return failure('登录密码不正确，请核对后重试。', 'invalid_password', 401);
    if (/^PT\d{3}$/.test(sqlCode)) {
      let normalized = String(details.code || (status === 409 ? 'conflict' : 'validation')).toLowerCase();
      if (normalized === 'revision_conflict') normalized = 'conflict';
      if (normalized === 'auth_required') normalized = 'unauthorized';
      const message = normalized === 'unauthorized' ? '请先登录后，再读取或保存云端档案。' : original.message || '云端操作未完成。';
      const error = failure(message, normalized, status);
      if (Number.isInteger(details.currentRevision)) error.currentRevision = details.currentRevision;
      return error;
    }
    if (['email_address_not_authorized', 'email_provider_disabled', 'email_not_confirmed', 'signup_disabled'].includes(code)) {
      if (code === 'email_address_not_authorized') return failure('站点的邮箱验证服务尚未向该邮箱开放，请稍后重试；你仍可继续试用课表。', 'email_service_unavailable', 503);
      return failure('站点登录服务尚未正确配置，请联系维护者。', 'cloud_not_ready', 503);
    }
    if (status === 429 || ['over_email_send_rate_limit', 'over_request_rate_limit', 'over_send_rate_limit'].includes(code)) {
      return failure(code === 'over_email_send_rate_limit' || code === 'over_send_rate_limit' ? '验证码发送过于频繁，请稍后再试，并检查垃圾邮件。' : '登录尝试过于频繁，请稍后再试。', 'rate_limited', 429);
    }
    if (['otp_expired', 'otp_disabled', 'validation_failed'].includes(code)) return failure('验证码无效或已过期，请核对邮箱和验证码，或重新获取。', 'invalid_otp', 400);
    if (original.name === 'AuthSessionMissingError' || code === 'AuthSessionMissingError' || code === 'session_not_found' || code === 'refresh_token_not_found' || code === 'PGRST301' || status === 401 || status === 403) {
      return failure('登录已过期，请重新登录后读取和保存云端档案。', 'unauthorized', 401);
    }
    if (code === 'PGRST202' || code === '42P01' || code === '42501') return failure('云端服务尚未完成配置，当前修改未保存，请联系站点维护者。', 'cloud_not_ready', 503);
    if (status === 404) return failure('云端档案或截图不存在，或你没有访问权限。', 'not_found', 404);
    if (status === 413) return failure('保存内容过大，请减少成绩记录或压缩截图。', 'too_large', 413);
    return failure('无法连接云端，修改尚未保存。请检查网络后重试。', 'network', status >= 500 ? status : 503);
  }
  function normalizeEmail(value) {
    const email = String(value || '').trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw failure('请填写有效的邮箱地址。', 'invalid_email', 400);
    return email;
  }
  function validId(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) throw failure('档案或成绩标识无效。', 'validation', 400);
    return value;
  }
  async function imageMime(blob) {
    if (!blob || typeof blob.arrayBuffer !== 'function' || !Number.isFinite(blob.size) || blob.size < 12 || blob.size > MAX_IMAGE) {
      throw failure('请选择 12 MB 以内的 PNG、JPEG 或 WebP 截图。', 'invalid_image', 400);
    }
    const bytes = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
    let mime = '';
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) mime = 'image/png';
    else if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) mime = 'image/jpeg';
    else if (String.fromCharCode(...bytes.slice(0,4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8,12)) === 'WEBP') mime = 'image/webp';
    if (!mime || (blob.type && blob.type !== mime)) throw failure('截图文件格式与内容不符，请重新导出 PNG、JPEG 或 WebP 图片。', 'invalid_image', 400);
    return mime;
  }
  function createProvider(input, dependencies) {
    const settings = validateConfig(input), deps = dependencies || {}, sdk = deps.supabase || root.supabase;
    let client = null, user = null, epoch = 0, initPromise = null, initialized = false, cleanupPromise = null;
    const listeners = new Set();
    const snapshotUser = () => user ? {...user} : null;
    function setUser(next) {
      const previousId = user?.id || null, nextId = next?.id || null;
      user = next;
      if (previousId !== nextId) {
        epoch++;
        const value = snapshotUser(), eventEpoch = epoch;
        // Supabase auth callbacks run inside an auth lock. Notify UI on the next task.
        setTimeout(() => {if (epoch !== eventEpoch) return; for (const listener of listeners) {try {listener(value ? {...value} : null);} catch {}}}, 0);
      }
    }
    function ensureClient() {
      if (!settings.configured) throw failure('云端服务尚未接通，你可以继续公开试用训练计划。', 'cloud_not_ready', 503);
      if (!sdk?.createClient) throw failure('云端登录组件未加载，请刷新页面后重试。', 'cloud_not_ready', 503);
      if (!client) {
        client = sdk.createClient(settings.url, settings.key, {
          auth: {persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'xunxu-auth-v3-' + new URL(settings.url).hostname},
          global: deps.fetch ? {fetch: deps.fetch} : undefined
        });
        client.auth.onAuthStateChange((event, session) => {
          if (event === 'INITIAL_SESSION') return;
          if (event === 'SIGNED_OUT') setUser(null);
          else if (session?.user) setUser(normalizeUser(session.user));
        });
      }
      return client;
    }
    async function init() {
      if (!settings.configured) return null;
      if (initialized) return snapshotUser();
      if (initPromise) return initPromise;
      initPromise = (async () => {
        const auth = ensureClient().auth, started = epoch, session = await auth.getSession();
        if (epoch !== started) {initialized = true; return snapshotUser();}
        if (session.error) throw mapError(session.error);
        if (!session.data?.session) {initialized = true; setUser(null); return null;}
        const expectedId = session.data.session.user?.id;
        const verified = await auth.getUser(session.data.session.access_token);
        if (epoch !== started) {initialized = true; return snapshotUser();}
        if (verified.error) {
          const error = mapError(verified.error);
          if (error.status === 401) {setUser(null); initialized = true; return null;}
          throw error;
        }
        if (verified.data?.user?.id !== expectedId) throw failure('登录身份已改变，请重新连接云端。', 'account_changed', 401);
        setUser(normalizeUser(verified.data?.user)); initialized = true;
        return snapshotUser();
      })().finally(() => {initPromise = null;});
      return initPromise;
    }
    async function sendCode(value) {
      const email = normalizeEmail(value);
      if (!settings.emailLoginEnabled) throw failure('邮箱验证服务尚未启用。课表试用仍可正常使用。', 'email_service_unavailable', 503);
      const {error} = await ensureClient().auth.signInWithOtp({email, options: {shouldCreateUser: true}});
      if (error) throw mapError(error);
      return {email};
    }
    async function verifyCode(value, valueToken) {
      const email = normalizeEmail(value), token = String(valueToken || '').trim();
      if (!/^\d{6,10}$/.test(token)) throw failure('请输入邮件中的数字验证码。', 'invalid_otp', 400);
      if (!settings.emailLoginEnabled) throw failure('邮箱验证码登录尚未启用。', 'email_service_unavailable', 503);
      const auth = ensureClient().auth, result = await auth.verifyOtp({email, token, type: 'email'});
      if (result.error) throw mapError(result.error);
      const expectedId = result.data?.user?.id || result.data?.session?.user?.id, started = epoch;
      if (!expectedId || user && user.id !== expectedId) throw failure('登录账号已改变，请重新确认正在使用的邮箱。', 'account_changed', 401);
      const verified = await auth.getUser(result.data?.session?.access_token);
      if (epoch !== started) throw failure('登录账号已改变，请重新确认正在使用的邮箱。', 'account_changed', 401);
      if (verified.error) throw mapError(verified.error);
      const next = normalizeUser(verified.data?.user);
      if (!next || next.id !== expectedId) throw failure('尚未完成邮箱验证，请重新获取验证码。', 'unauthorized', 401);
      initialized = true; setUser(next); return snapshotUser();
    }
    async function signInWithPassword(value) {
      const password = String(value || '');
      if (!settings.passwordLoginEnabled) throw failure('密码云登录尚未启用。课表试用仍可正常使用。', 'cloud_not_ready', 503);
      if (!password || password.length > 128) throw failure('请输入有效的登录密码。', 'invalid_password', 400);
      const auth = ensureClient().auth, result = await auth.signInWithPassword({email: settings.sharedLoginEmail, password});
      if (result.error) throw mapError(result.error);
      const expectedId = result.data?.user?.id || result.data?.session?.user?.id, started = epoch;
      if (!expectedId) throw failure('登录未完成，请重试。', 'unauthorized', 401);
      const verified = await auth.getUser(result.data?.session?.access_token);
      if (epoch !== started) throw failure('登录状态已改变，请重新输入密码。', 'account_changed', 401);
      if (verified.error) throw mapError(verified.error);
      const next = normalizeUser(verified.data?.user);
      if (!next || next.id !== expectedId) throw failure('服务器账号尚未完成验证，请联系站点维护者。', 'unauthorized', 401);
      initialized = true; setUser(next); return snapshotUser();
    }
    async function signOut() {
      if (!client) {setUser(null); return;}
      const {error} = await client.auth.signOut({scope: 'local'});
      if (error) throw mapError(error);
      setUser(null); initialized = true;
    }
    function guard(context) {
      if (!user || user.id !== context.owner || epoch !== context.epoch) throw failure('登录账号已改变，已停止原账号的读取和保存。请重新打开自己的档案。', 'account_changed', 401);
      if (context.signal?.aborted) throw failure('读取已取消。', 'aborted', 499);
    }
    async function contextFor(expectedId, signal) {
      if (!expectedId || user?.id !== expectedId) throw failure('请先登录，再读取或保存云端档案。', 'unauthorized', 401);
      const context = {owner: expectedId, epoch, signal};
      const result = await ensureClient().auth.getSession();
      guard(context);
      if (result.error) throw mapError(result.error);
      const session = result.data?.session;
      if (!session?.access_token || session.user?.id !== expectedId) throw failure('登录状态已改变，请重新登录。', 'unauthorized', 401);
      const token = session.access_token;
      // Every step of an upload/save uses the same owner's token, even if another tab signs in.
      context.api = sdk.createClient(settings.url, settings.key, {
        accessToken: async () => {guard(context); return token;},
        global: deps.fetch ? {fetch: deps.fetch} : undefined
      });
      return context;
    }
    async function rpc(context, name, args) {
      guard(context);
      let result;
      try {result = await context.api.rpc(name, args || {});} catch (error) {throw mapError(error);}
      guard(context);
      if (result.error) throw mapError(result.error);
      return result.data;
    }
    function cleanup(context) {
      if (cleanupPromise) return;
      cleanupPromise = (async () => {
        const result = await rpc(context, 'xunxu_claim_cleanup', {p_limit: 10});
        for (const item of result?.items || []) {
          guard(context);
          if (item.bucket !== 'xunxu-results' || typeof item.key !== 'string') continue;
          const {error} = await context.api.storage.from(item.bucket).remove([item.key]);
          guard(context);
          if (!error) await rpc(context, 'xunxu_ack_cleanup', {p_upload_id: item.uploadId});
        }
      })().catch(() => {}).finally(() => {cleanupPromise = null;});
    }
    function json(value, status = 200) {
      return new Response(JSON.stringify(value), {status, headers: {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store'}});
    }
    async function perform(expectedId, rawUrl, initOptions) {
      const options = initOptions || {}, method = String(options.method || 'GET').toUpperCase();
      let path;
      try {path = new URL(String(rawUrl), 'https://xunxu.invalid').pathname;} catch {throw failure('请求路径无效。', 'validation', 400);}
      const context = await contextFor(expectedId, options.signal);
      if (path === '/api/cloud/session' && method === 'GET') {
        const result = await rpc(context, 'xunxu_list_profiles'); cleanup(context);
        return json({user: snapshotUser(), profiles: result.profiles});
      }
      const match = path.match(/^\/api\/cloud\/profiles(?:\/([A-Za-z0-9_-]{1,100}))?(?:\/images\/([A-Za-z0-9_-]{1,100}))?$/);
      if (!match) throw failure('请求路径不存在。', 'not_found', 404);
      const profileId = match[1], recordId = match[2];
      if (profileId && recordId && method === 'GET') {
        const item = await rpc(context, 'xunxu_get_image_key', {p_profile_id: profileId, p_record_id: recordId});
        if (item.bucket !== 'xunxu-results') throw failure('云端截图地址无效。', 'invalid_image', 502);
        const result = await context.api.storage.from(item.bucket).download(item.key);
        guard(context); if (result.error) throw mapError(result.error);
        const mime = await imageMime(result.data); guard(context);
        return new Response(result.data, {headers: {'Content-Type': mime, 'Cache-Control': 'private, no-store'}});
      }
      if (profileId && !recordId && method === 'GET') return json(await rpc(context, 'xunxu_get_profile', {p_profile_id: profileId}));
      if (recordId || !['POST', 'PUT'].includes(method)) throw failure('请求方法无效。', 'validation', 405);
      let payload, uploadBlob, imageRecordId;
      try {
        if (options.body && typeof options.body.get === 'function') {
          payload = JSON.parse(options.body.get('payload')); uploadBlob = options.body.get('image'); imageRecordId = options.body.get('imageRecordId');
        } else payload = JSON.parse(options.body || '{}');
      } catch {throw failure('保存数据格式无效。', 'validation', 400);}
      if (!payload?.data || new TextEncoder().encode(JSON.stringify(payload.data)).length > MAX_DATA) throw failure('档案内容超过大小限制，请整理后重试。', 'too_large', 413);
      if (!profileId && method === 'POST') {
        const result = await rpc(context, 'xunxu_create_profile', {p_profile_id: validId(payload.id), p_name: payload.name, p_data: payload.data});
        return json(result, 201);
      }
      if (!profileId || method !== 'PUT' || !Number.isInteger(payload.revision)) throw failure('档案版本无效，请重新读取。', 'validation', 400);
      let uploadId = null;
      if (uploadBlob) {
        validId(imageRecordId);
        if (!Array.isArray(payload.data.records) || !payload.data.records.some(record => record.id === imageRecordId && record.profileId === profileId)) throw failure('截图必须属于当前档案的本次成绩。', 'validation', 400);
        const mime = await imageMime(uploadBlob); guard(context);
        const ticket = await rpc(context, 'xunxu_prepare_image', {p_profile_id: profileId, p_record_id: imageRecordId, p_revision: payload.revision, p_mime_type: mime, p_size_bytes: uploadBlob.size});
        if (ticket.bucket !== 'xunxu-results') throw failure('云端上传地址无效。', 'invalid_image', 502);
        guard(context);
        const uploaded = await context.api.storage.from(ticket.bucket).upload(ticket.key, uploadBlob, {contentType: mime, upsert: false, cacheControl: '0'});
        guard(context); if (uploaded.error) throw mapError(uploaded.error);
        uploadId = ticket.uploadId;
      }
      let result;
      try {
        result = await rpc(context, 'xunxu_save_profile', {p_profile_id: profileId, p_revision: payload.revision, p_data: payload.data, p_name: payload.name || null, p_upload_id: uploadId});
      } catch (error) {
        cleanup(context);
        if (error.status >= 500 || error.code === 'network') throw failure('暂时无法确认这次保存是否完成。修改仍在页面中，请重新读取云端核对，避免覆盖新数据。', 'save_uncertain', 409);
        throw error;
      }
      cleanup(context); return json(result);
    }
    async function transport(owner, url, options) {
      try {return await perform(owner, url, options);} catch (source) {
        const error = mapError(source);
        return json({error: error.message, code: error.code, ...(Number.isInteger(error.currentRevision) ? {currentRevision: error.currentRevision} : {})}, error.status || 503);
      }
    }
    return {
      isConfigured: () => settings.configured,
      isEmailLoginEnabled: () => settings.emailLoginEnabled,
      isPasswordLoginEnabled: () => settings.passwordLoginEnabled,
      init, getUser: snapshotUser, sendCode, verifyCode, signInWithPassword, signOut,
      onAuthChange: callback => {listeners.add(callback); return () => listeners.delete(callback);},
      createFetch: owner => (url, options) => transport(owner, url, options),
      fetch: (url, options) => transport(user?.id, url, options)
    };
  }
  const exported = {createProvider, validateConfig, normalizeUser, normalizeEmail, mapError, imageMime};
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  else root.XunxuCloud = createProvider(root.XUNXU_CONFIG || {});
})(typeof window !== 'undefined' ? window : globalThis);
