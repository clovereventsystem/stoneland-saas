require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const app = express();
const port = process.env.PORT || 3002;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

app.post('/api/check-event', async (req, res) => {
  const { eventId } = req.body;
  try {
    const { data, error } = await supabase.from('events').select('id, admin_pwd').eq('id', eventId).maybeSingle();
    if (error || !data) return res.json({ success: true, exists: false });
    return res.json({ success: true, exists: true, isSetup: !!data.admin_pwd });
  } catch(e) { res.status(500).json({success: false}); }
});

app.post('/api/setup-event', async (req, res) => {
  const { eventId, adminPwd, judgePwd } = req.body;
  try {
    const defaultExpiry = new Date();
    defaultExpiry.setDate(defaultExpiry.getDate() + 30);
    const expireDateStr = defaultExpiry.toISOString().split('T')[0];

    await supabase.from('events').update({ 
      admin_pwd: adminPwd, judge_pwd: judgePwd, 
      system_version: 'Basic', expire_at: expireDateStr,
      name: '', subtitle: '' // 初始化时清空名字
    }).eq('id', eventId);
    res.json({ success: true });
  } catch(e) { res.status(500).json({success: false}); }
});

app.post('/api/login', async (req, res) => {
  const { eventId, password } = req.body;
  if (!eventId || !password) return res.status(400).json({ success: false, message: '信息不完整' });

  try {
    const { data: event, error } = await supabase.from('events').select('*').eq('id', eventId).maybeSingle();
    if (error || !event) return res.status(401).json({ success: false, message: '赛事不存在' });

    let role = '';
    if (password === event.admin_pwd) role = 'admin';
    else if (password === event.judge_pwd) role = 'judge';

    if (!role) return res.status(401).json({ success: false, message: '密码错误，请重试' });
    res.json({ success: true, message: '登录成功', role: role, eventId: event.id });
  } catch (error) { res.status(500).json({ success: false }); }
});

app.get('/api/system-data', async (req, res) => {
  const { eventId } = req.query;
  if (!eventId) return res.status(401).json({ success: false, message: '未授权的访问' });
  try {
    const [eventsRes, judgesRes, contestantsRes, scoresRes] = await Promise.all([
      supabase.from('events').select('*').eq('id', eventId).maybeSingle(),
      supabase.from('judges').select('*').eq('event_id', eventId),
      supabase.from('contestants').select('*').eq('event_id', eventId).order('no', { ascending: true }),
      supabase.from('scores').select('*') 
    ]);
    const event = eventsRes.data || {};
    
    const expDateStr = event.expire_at || '2099-12-31'; 
    const expireDateObj = new Date(expDateStr);
    expireDateObj.setHours(23, 59, 59, 999);
    const isExpired = new Date() > expireDateObj;

    res.json({
      success: true,
      system: {
        // 🌟 修复：去掉硬编码的默认词汇，有啥拿啥，没啥给空字符串
        eventName: event.name || '', 
        eventSubtitle: event.subtitle || '',
        currentRound: event.current_round || 1, finalSeats: event.final_seats || 5,
        enableDetails: event.enable_details !== false, systemVersion: event.system_version || 'Basic',
        judges: judgesRes.data || [], contestants: contestantsRes.data || [],
        isExpired: isExpired, expirationDate: expDateStr, startNo: event.start_no || 1, revealState: event.reveal_state || {}
      },
      scores: scoresRes.data || []
    });
  } catch (error) { res.status(500).json({ success: false }); }
});

app.post('/api/manage', async (req, res) => {
  const { table, action, eventId, data } = req.body;
  try {
    if (action === 'add') { await supabase.from(table).insert({ ...data, event_id: eventId }); } 
    else if (action === 'update') { await supabase.from(table).update(data).eq('id', data.id).eq('event_id', eventId); } 
    else if (action === 'delete') { await supabase.from(table).delete().eq('id', data.id).eq('event_id', eventId); }
    res.json({ success: true });
  } catch (error) { res.status(500).json({ success: false }); }
});

// 🌟 核心修复：更新赛事设置时，即使是空字符串也能正常保存进数据库
app.post('/api/events/settings', async (req, res) => {
  const { eventId, data } = req.body;
  try { 
    await supabase.from('events').update(data).eq('id', eventId); 
    res.json({ success: true }); 
  } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/api/scores/submit', async (req, res) => {
  const { contestantId, round, judgeId, score } = req.body;
  try { await supabase.from('scores').upsert({ contestant_id: String(contestantId), judge_id: String(judgeId), round: Number(round), score: Number(score) }, { onConflict: 'contestant_id, judge_id, round' }); res.json({ success: true }); } 
  catch (error) { res.status(500).json({ success: false }); }
});

app.post('/api/scores/delete', async (req, res) => {
  const { contestantId, round, judgeId } = req.body;
  try {
    let query = supabase.from('scores').delete().eq('judge_id', String(judgeId)).eq('round', Number(round));
    if (contestantId) query = query.eq('contestant_id', String(contestantId));
    await query; res.json({ success: true });
  } catch (error) { res.status(500).json({ success: false }); }
});

app.listen(port, () => { console.log(`🚀 SaaS 后端服务已启动，端口: ${port}`); });