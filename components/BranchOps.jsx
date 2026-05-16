'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { loadKey, saveKey } from '@/lib/supabase'
import {
  TRUCK_TYPES, LINE, GROUND_REASONS, PM_REASONS, PM_STATUSES,
  GROUND_PRIORITY, INIT_STATE,
} from '@/lib/constants'

// ── utils ─────────────────────────────────────────────────────────────────
const uid      = () => Math.random().toString(36).slice(2, 9)
const fmtDate  = d => { if (!d) return ''; const [y,m,day]=d.split('-'); return `${m}/${day}/${y.slice(2)}` }
const daysUntil= d => { if (!d) return null; return Math.round((new Date(d+'T00:00:00')-new Date(new Date().toDateString()))/86400000) }
const DAY_LABELS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
const todayLabel = DAY_LABELS[new Date().getDay()]

// ── debounce ──────────────────────────────────────────────────────────────
function useDebounce(val, ms) {
  const [deb, setDeb] = useState(val)
  useEffect(() => { const t = setTimeout(() => setDeb(val), ms); return () => clearTimeout(t) }, [val, ms])
  return deb
}

export default function BranchOps() {
  const [S, setS]           = useState(INIT_STATE)
  const [tab, setTab]       = useState('dash')
  const [search, setSearch] = useState('')
  const [removeQ, setRemoveQ] = useState('')
  const [notif, setNotif]   = useState(null)
  const [modal, setModal]   = useState(null)
  const [form, setForm]     = useState({})
  const [goModal, setGoModal]   = useState(null)
  const [goForm, setGoForm]     = useState({})
  const [hikeInMod, setHikeInMod]   = useState(null)
  const [hikeInFrom, setHikeInFrom] = useState('')
  const [hikeOutMod, setHikeOutMod]   = useState(null)
  const [hikeOutDest, setHikeOutDest] = useState('')
  const [history, setHistory]   = useState([])
  const [histOpen, setHistOpen] = useState(false)
  const [taskInput, setTaskInput] = useState('')
  const [aiInput, setAiInput]   = useState('')
  const [aiLoading, setAiLoad]  = useState(false)
  const [aiPreview, setAiPrev]  = useState(null)
  const [aiHistory, setAiHist]  = useState([])
  const [dbReady, setDbReady]   = useState(false)
  const notifTimer = useRef(null)
  const saveTimer  = useRef(null)

  // ── persistence: load once ───────────────────────────────────────────────
  useEffect(() => {
    ;(async () => {
      const [st, hist] = await Promise.all([loadKey('state'), loadKey('history')])
      if (st)   setS(prev => ({ ...INIT_STATE, ...st }))
      if (hist) setHistory(hist)
      setDbReady(true)
    })()
  }, [])

  // ── persistence: debounced save ──────────────────────────────────────────
  const debS    = useDebounce(S, 1500)
  const debHist = useDebounce(history, 1500)
  useEffect(() => { if (dbReady) saveKey('state',   debS)    }, [debS,    dbReady])
  useEffect(() => { if (dbReady) saveKey('history', debHist) }, [debHist, dbReady])

  // ── notify ────────────────────────────────────────────────────────────────
  const notify = useCallback(msg => {
    setNotif(msg); clearTimeout(notifTimer.current)
    notifTimer.current = setTimeout(() => setNotif(null), 3000)
  }, [])

  // ── unit helpers ──────────────────────────────────────────────────────────
  const findUnit  = num => S.units.find(u => u.unit === String(num).trim())
  const yardByTT  = tt  => S.units.filter(u => u.tt === tt && !u.wentOut && u.status !== 'hiking-out')
  const updateUnit= (id, ch) => setS(s => ({ ...s, units: s.units.map(u => u.id===id ? {...u,...ch} : u) }))

  // ── yard actions ──────────────────────────────────────────────────────────
  function saveUnit() {
    if (!form.unit?.trim()) return
    if (!form.id && findUnit(form.unit)) { notify(`⚠️ Unit ${form.unit} already exists`); return }
    const patch = { unit:form.unit.trim(), tt:form.tt||TRUCK_TYPES[0], line:form.line||'RL', isPuro:!!form.isPuro, note:form.note||'', shopDate:form.shopDate||'' }
    setS(s => {
      const units = form.id
        ? s.units.map(u => u.id===form.id ? {...u,...patch} : u)
        : [...s.units, { id:uid(), ...patch, status:'available', goingOut:false, wentOut:false, awaitingArrival:false, hikeId:null }]
      let pm = s.pms
      if (form.addPM && !s.pms.find(p=>p.unit===patch.unit))
        pm = [...pm, { id:uid(), unitId:form.id||'', unit:patch.unit, tt:patch.tt, reason:'Routine PM', status:'Flagged', swapUnit:'', note:'' }]
      let tomorrow = s.tomorrow
      if (form.addTomorrow && !(s.tomorrow[patch.tt]||[]).find(c=>c.unit===patch.unit))
        tomorrow = { ...tomorrow, [patch.tt]: [...(tomorrow[patch.tt]||[]), { id:uid(), unit:patch.unit, hold:false, note:'' }] }
      return { ...s, units, pms:pm, tomorrow }
    })
    closeModal(); notify(`Unit ${form.unit.trim()} saved ✓`)
  }

  function markGoingOut(unitId) {
    const u = S.units.find(u=>u.id===unitId); if (!u) return
    updateUnit(unitId, { goingOut: !u.goingOut })
    notify(u.goingOut ? `Unit ${u.unit} unmarked` : `Unit ${u.unit} going out ✓`)
  }

  function openWentOut(unit) {
    const twoW = new Date(); twoW.setDate(twoW.getDate()+14)
    setGoModal({ unitId:unit.id, unit:unit.unit, tt:unit.tt })
    setGoForm({ customer:'', returnDate:twoW.toISOString().split('T')[0] })
  }

  function confirmWentOut() {
    if (!goModal) return
    const u = S.units.find(u=>u.id===goModal.unitId); if (!u) return
    const resoCard = { id:uid(), unit:u.unit, customer:goForm.customer||'', returnDate:goForm.returnDate||'', note:'' }
    setS(s => ({
      ...s,
      units: s.units.map(u2 => u2.id===goModal.unitId ? {...u2, goingOut:false, wentOut:true, status:'out'} : u2),
      reso:  { ...s.reso, [u.tt]: [...(s.reso[u.tt]||[]), resoCard] },
      tasks: [...s.tasks, { id:uid(), done:false, type:'return', unit:u.unit, tt:u.tt, text:`Unit ${u.unit} — return due ${fmtDate(goForm.returnDate)}` }],
    }))
    setGoModal(null); notify(`Unit ${u.unit} → Reso ✓`)
  }

  function checkInFromReso(tt, resoCard) {
    const u = findUnit(resoCard.unit)
    setS(s => ({
      ...s,
      units: u
        ? s.units.map(u2 => u2.id===u.id ? {...u2, wentOut:false, status:'available', line:'WL', goingOut:false} : u2)
        : [...s.units, { id:uid(), unit:resoCard.unit, tt, line:'WL', isPuro:false, note:'Returned from reso', shopDate:'', status:'available', goingOut:false, wentOut:false, awaitingArrival:false, hikeId:null }],
      reso:  { ...s.reso, [tt]: s.reso[tt].filter(c=>c.id!==resoCard.id) },
      tasks: [...s.tasks, { id:uid(), done:false, type:'checkin', unit:resoCard.unit, tt, text:`Unit ${resoCard.unit} check-in — inspect and assign line` }],
    }))
    notify(`Unit ${resoCard.unit} → WL ✓`)
  }

  // ── ground actions ────────────────────────────────────────────────────────
  function groundUnit(unitId, reason, estimatedReadyDate='', note='') {
    const u = S.units.find(u=>u.id===unitId); if (!u) return
    const priority = GROUND_PRIORITY[reason] || 'normal'
    const blockedReso = S.resos ? null : null // find if unit has active reso
    const g = { id:uid(), unitId, unit:u.unit, tt:u.tt, reason, priority, estimatedReadyDate, note, blockedResoId:null }
    setS(s => {
      const blockedR = Object.values(s.reso).flat().find(r=>r.unit===u.unit)
      return {
        ...s,
        units:   s.units.map(u2 => u2.id===unitId ? {...u2, status:'grounded', line:'SL'} : u2),
        grounds: [...s.grounds, { ...g, blockedResoId: blockedR?.id||null }],
      }
    })
    notify(`Unit ${u.unit} grounded (${reason}) ✓`)
  }

  function returnFromGround(groundId, line='SRL') {
    const g = S.grounds.find(g=>g.id===groundId); if (!g) return
    setS(s => ({
      ...s,
      units:   s.units.map(u => u.id===g.unitId ? {...u, status:'available', line} : u),
      grounds: s.grounds.filter(g2=>g2.id!==groundId),
    }))
    notify(`Unit ${g.unit} → ${line} ✓`)
  }

  function updateGround(id, changes) {
    setS(s => ({ ...s, grounds: s.grounds.map(g => g.id===id ? {...g,...changes} : g) }))
  }

  // ── PM actions ────────────────────────────────────────────────────────────
  function schedulePM(unitId, reason, note='') {
    const u = S.units.find(u=>u.id===unitId); if (!u) return
    const swap = S.units.find(u2 => u2.tt===u.tt && u2.id!==unitId && ['RL','WL','SRL'].includes(u2.line) && !u2.isPuro && !u2.goingOut && u2.status==='available')
    const pm = { id:uid(), unitId, unit:u.unit, tt:u.tt, reason, status:'Flagged', swapUnit:swap?.unit||'', note }
    setS(s => ({ ...s, pms: [...s.pms, pm] }))
    notify(`PM for ${u.unit}${swap?` · Swap: ${swap.unit}`:''} ✓`)
  }

  function advancePM(pmId) {
    const pm = S.pms.find(p=>p.id===pmId); if (!pm) return
    const idx  = PM_STATUSES.indexOf(pm.status)
    const next = PM_STATUSES[idx+1]; if (!next) return
    const done = next === 'Picked Up'
    setS(s => ({
      ...s,
      pms:   done ? s.pms.filter(p=>p.id!==pmId) : s.pms.map(p=>p.id===pmId?{...p,status:next}:p),
      units: done ? s.units.map(u=>u.id===pm.unitId?{...u,status:'available',line:'SRL'}:u) : s.units,
    }))
    notify(done ? `Unit ${pm.unit} PM done → SRL ✓` : `PM → ${next} ✓`)
  }

  // ── hike actions ──────────────────────────────────────────────────────────
  function confirmHikeOut() {
    if (!hikeOutMod) return
    const dest = hikeOutDest.trim() || 'Unknown'
    const hike = { id:uid(), unit:hikeOutMod.unit, tt:hikeOutMod.tt, dir:'out', location:dest, arrival:'', placed:true, ready:false, pmDue:false, note:'' }
    setS(s => {
      const bh = { ...s.branchHikeHistory }
      if (!bh[dest]) bh[dest]={in:0,out:0}; bh[dest].out=(bh[dest].out||0)+1
      return {
        ...s,
        units:  s.units.map(u=>u.id===hikeOutMod.unitId?{...u,status:'hiking-out',hikeId:hike.id}:u),
        hikes:  [...s.hikes, hike],
        sent:   [...s.sent,  { id:uid(), unit:hikeOutMod.unit, tt:hikeOutMod.tt, location:dest, note:'Hiked out' }],
        branchHikeHistory: bh,
      }
    })
    setHikeOutMod(null); notify(`Unit ${hikeOutMod.unit} hiked out → ${dest} ✓`)
  }

  function confirmHikeIn() {
    if (!hikeInMod) return
    const from = hikeInFrom.trim() || 'Unknown'
    const hike = { id:uid(), unit:hikeInMod.unit, tt:hikeInMod.tt, dir:'in', location:from, arrival:'', placed:false, ready:false, pmDue:false, note:'' }
    setS(s => {
      const bh = { ...s.branchHikeHistory }
      if (!bh[from]) bh[from]={in:0,out:0}; bh[from].in=(bh[from].in||0)+1
      return {
        ...s,
        units:  s.units.map(u=>u.id===hikeInMod.unitId?{...u,awaitingArrival:true,status:'awaiting-arrival',hikeId:hike.id}:u),
        hikes:  [...s.hikes, hike],
        branchHikeHistory: bh,
      }
    })
    setHikeInMod(null); notify(`Unit ${hikeInMod.unit} awaiting arrival from ${from} ✓`)
  }

  function confirmArrival(unit) {
    setS(s => ({
      ...s,
      units: s.units.map(u=>u.id===unit.id?{...u,awaitingArrival:false,status:'available',line:'WL',hikeId:null}:u),
      hikes: s.hikes.map(h=>h.unit===unit.unit?{...h,placed:true,ready:true}:h),
      tasks: [...s.tasks, { id:uid(), done:false, type:'hike-arrive', unit:unit.unit, text:`Unit ${unit.unit} arrived — inspect and assign line` }],
    }))
    notify(`Unit ${unit.unit} arrived ✓`)
  }

  // ── remove unit ───────────────────────────────────────────────────────────
  function removeUnit(num) {
    if (!num?.trim()) return
    const n = String(num).trim()
    setS(s => ({
      ...s,
      units:    s.units.filter(u=>u.unit!==n),
      reso:     Object.fromEntries(TRUCK_TYPES.map(tt=>[tt,(s.reso[tt]||[]).filter(c=>c.unit!==n)])),
      tomorrow: Object.fromEntries(TRUCK_TYPES.map(tt=>[tt,(s.tomorrow[tt]||[]).filter(c=>c.unit!==n)])),
      pms:      s.pms.filter(p=>p.unit!==n),
      grounds:  s.grounds.filter(g=>g.unit!==n),
      hikes:    s.hikes.filter(h=>h.unit!==n),
      sent:     s.sent.filter(c=>c.unit!==n),
      checkins: s.checkins.filter(c=>c.unit!==n),
      tasks:    s.tasks.filter(t=>t.unit!==n),
    }))
    notify(`Unit ${n} removed ✓`); setRemoveQ('')
  }

  // ── AI command bar ────────────────────────────────────────────────────────
  async function runAI(input) {
    if (!input?.trim() || aiLoading) return
    setAiLoad(true); setAiInput('')
    const ctx = {
      units:   S.units.map(u=>({unit:u.unit,tt:u.tt,line:u.line,status:u.status,goingOut:u.goingOut,awaitingArrival:u.awaitingArrival})),
      reso:    Object.values(S.reso).flat().map(r=>({unit:r.unit,customer:r.customer,returnDate:r.returnDate})),
      grounds: S.grounds.map(g=>({unit:g.unit,reason:g.reason,priority:g.priority})),
      pms:     S.pms.map(p=>({unit:p.unit,reason:p.reason,status:p.status})),
    }
    try {
      const res  = await fetch('/api/ai-command', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ input, context:ctx }) })
      const data = await res.json()
      if (data.error) { notify(`AI: ${data.error}`); setAiLoad(false); return }
      const action = data.action
      setAiHist(h=>[...h.slice(-9),{input,action}])
      if (action.type==='clarify')  setAiPrev({type:'clarify',question:action.question,input})
      else if (action.type==='unknown') notify(action.message||"Couldn't understand that")
      else setAiPrev(action)
    } catch(e) { notify('AI error — check console') }
    setAiLoad(false)
  }

  function execAI(action) {
    setAiPrev(null)
    const u = () => findUnit(action.unit)
    switch (action.type) {
      case 'add_unit':           { const uu=u(); if(!uu) saveUnit.call({...action,id:null}); else notify(`Unit ${action.unit} exists`); break }
      case 'going_out':          { const uu=u(); uu?markGoingOut(uu.id):notify(`Unit ${action.unit} not found`); break }
      case 'went_out':           { const uu=u(); if(uu){setGoModal({unitId:uu.id,unit:uu.unit,tt:uu.tt});setGoForm({customer:action.customer||'',returnDate:action.returnDate||''});} break }
      case 'came_back':          { const r=Object.values(S.reso).flat().find(r=>r.unit===String(action.unit).trim()); if(r){const tt=TRUCK_TYPES.find(tt=>S.reso[tt]?.find(x=>x.id===r.id));checkInFromReso(tt,r);}else{const uu=u();if(uu)updateUnit(uu.id,{line:action.line||'WL',status:'available',wentOut:false});} break }
      case 'ground_unit':        { const uu=u(); uu?groundUnit(uu.id,action.reason||'CFI',action.estimatedReadyDate||'',action.note||''):notify(`Unit ${action.unit} not found`); break }
      case 'return_from_ground': { const g=S.grounds.find(g=>g.unit===String(action.unit).trim()); g?returnFromGround(g.id,action.line||'SRL'):notify(`Unit ${action.unit} not grounded`); break }
      case 'schedule_pm':        { const uu=u(); uu?schedulePM(uu.id,action.reason||'Routine PM',action.note||''):notify(`Unit ${action.unit} not found`); break }
      case 'advance_pm':         { const pm=S.pms.find(p=>p.unit===String(action.unit).trim()); pm?advancePM(pm.id):notify(`Unit ${action.unit} has no active PM`); break }
      case 'hike_out':           { const uu=u(); if(uu){setHikeOutMod({unitId:uu.id,unit:uu.unit,tt:uu.tt});setHikeOutDest(action.destination||'');} break }
      case 'hike_in':            { const uu=u(); if(uu){setHikeInMod({unitId:uu.id,unit:uu.unit,tt:uu.tt});setHikeInFrom(action.from||'');} break }
      case 'confirm_arrival':    { const uu=u(); uu?confirmArrival(uu):notify(`Unit ${action.unit} not found`); break }
      case 'update_line':        { const uu=u(); uu?(updateUnit(uu.id,{line:action.line}),notify(`Unit ${action.unit} → ${action.line} ✓`)):notify(`Unit ${action.unit} not found`); break }
      case 'remove_unit':        removeUnit(action.unit); break
      case 'add_tomorrow': {
        const tt=action.tt||TRUCK_TYPES[3]
        setS(s=>({...s,tomorrow:{...s.tomorrow,[tt]:[...(s.tomorrow[tt]||[]),{id:uid(),unit:action.unit||'',hold:!!action.hold,note:action.note||''}]}}))
        notify(`Added to tomorrow (${tt}) ✓`); break
      }
    }
  }

  // ── new day ───────────────────────────────────────────────────────────────
  function newDay() {
    const snap = JSON.parse(JSON.stringify(S))
    setHistory(h=>[...h,{dayNum:S.dayNum,label:todayLabel,snap}])
    setS(s=>({
      ...s, dayNum:s.dayNum+1,
      units:    s.units.map(u=>({...u,goingOut:false})),
      tomorrow: Object.fromEntries(TRUCK_TYPES.map(t=>[t,[]])),
      tasks:    s.tasks.filter(t=>!t.done),
    }))
    notify(`Day ${S.dayNum+1} started ✓`)
  }

  // ── misc helpers ──────────────────────────────────────────────────────────
  const toggleHold      = (tt,id) => setS(s=>({...s,tomorrow:{...s.tomorrow,[tt]:s.tomorrow[tt].map(c=>c.id===id?{...c,hold:!c.hold}:c)}}))
  const toggleHikeField = (id,f)  => setS(s=>({...s,hikes:s.hikes.map(h=>h.id===id?{...h,[f]:!h[f]}:h)}))
  const toggleTask      = id      => setS(s=>({...s,tasks:s.tasks.map(t=>t.id===id?{...t,done:!t.done}:t)}))
  const addTask         = txt     => { if(!txt.trim())return; setS(s=>({...s,tasks:[...s.tasks,{id:uid(),done:false,type:'general',unit:'',text:txt.trim()}]})) }
  const delTask         = id      => setS(s=>({...s,tasks:s.tasks.filter(t=>t.id!==id)}))

  function openModal(type,tt=null,card=null){
    setModal({type,tt,card})
    if(card&&type==='yard'){
      const hasPM  = S.pms.find(p=>p.unit===card.unit)
      const hasTom = Object.values(S.tomorrow).flat().find(c=>c.unit===card.unit)
      setForm({...card,addPM:!!hasPM,addTomorrow:!!hasTom,goingOut:!!card.goingOut})
    } else {
      setForm(card?{...card}:{unit:'',line:'RL',isPuro:false,note:'',shopDate:'',returnDate:'',customer:'',pmDate:'',dir:'in',location:'',arrival:'',placed:false,ready:false,pmDue:false,hold:false,addPM:false,addTomorrow:false,tt:tt||''})
    }
  }
  function closeModal(){setModal(null);setForm({})}
  const sf = k => e => setForm(f=>({...f,[k]:e.target.type==='checkbox'?e.target.checked:e.target.value}))

  // ── derived stats ─────────────────────────────────────────────────────────
  const onYard      = S.units.filter(u=>!u.wentOut&&u.status!=='hiking-out')
  const totalYard   = onYard.length
  const totalReso   = Object.values(S.reso).flat().length
  const totalTom    = Object.values(S.tomorrow).flat().length
  const avail       = onYard.filter(u=>['RL','WL','SRL'].includes(u.line)&&!u.isPuro&&!u.goingOut&&!u.awaitingArrival&&u.status!=='grounded').length
  const goingOut    = S.units.filter(u=>u.goingOut).length
  const tasksDone   = S.tasks.filter(t=>t.done).length
  const returnAlerts= []
  TRUCK_TYPES.forEach(tt=>(S.reso[tt]||[]).forEach(c=>{const d=daysUntil(c.returnDate);if(d!==null&&d<=1)returnAlerts.push({...c,tt,days:d})}))

  // ── search ────────────────────────────────────────────────────────────────
  const searchResults = !search.trim() ? null : (() => {
    const q=search.trim().toLowerCase(),res=[]
    S.units.forEach(u=>{if(u.unit.toLowerCase().includes(q)){const where=u.wentOut?'Reso':u.awaitingArrival?'Awaiting':u.status==='hiking-out'?'Hike ↑':u.status==='grounded'?'Grounded':'Yard';res.push({where,tt:u.tt,unit:u.unit,detail:u.line})}})
    Object.entries(S.reso).forEach(([tt,cards])=>cards.forEach(c=>{if(c.unit.toLowerCase().includes(q)&&!res.find(r=>r.unit===c.unit))res.push({where:'Reso',tt,unit:c.unit,detail:c.customer})}))
    S.hikes.forEach(c=>{if(c.unit.toLowerCase().includes(q)&&!res.find(r=>r.unit===c.unit))res.push({where:`Hike ${c.dir==='in'?'↓':'↑'}`,tt:c.tt,unit:c.unit,detail:c.location})})
    return res
  })()

  // ── yard card ─────────────────────────────────────────────────────────────
  const YardCard = ({ card }) => {
    const ls   = card.isPuro?{bg:'#a855f7',text:'#f5f3ff'}:(LINE[card.line]||LINE.RL)
    const hasPM = S.pms.find(p=>p.unit===card.unit)
    const hasTom= Object.values(S.tomorrow).flat().find(c=>c.unit===card.unit)
    const isGnd = S.grounds.find(g=>g.unit===card.unit)

    if (card.awaitingArrival) return (
      <div style={{background:'#f0fff4',border:'2px dashed #16a34a',borderRadius:10,padding:'8px 9px',position:'relative'}}>
        <div style={{fontSize:13,fontWeight:700,color:'#166534'}}>{card.unit}</div>
        <div style={{fontSize:9,color:'#16a34a',marginTop:2}}>✈️ {card.tt} · Awaiting arrival</div>
        <button style={{marginTop:5,width:'100%',background:'#16a34a',border:'none',borderRadius:4,color:'#fff',fontSize:9,fontWeight:700,padding:'3px 0',cursor:'pointer',fontFamily:'inherit'}} onClick={()=>confirmArrival(card)}>✅ Arrived</button>
        <button className='xcbtn' onClick={e=>{e.stopPropagation();setS(s=>({...s,units:s.units.filter(u=>u.id!==card.id)}))}}>✕</button>
      </div>
    )
    return (
      <div className={`ucard ${card.goingOut?'ucard-go':''}`}
        style={{background:ls.bg,color:ls.text,outline:hasTom&&!card.goingOut?'2px solid #f59e0b':undefined,outlineOffset:2}}
        onClick={()=>openModal('yard',card.tt,card)}>
        <div className={`unum ${hasPM?'pm-b':''}`}>{card.unit}</div>
        <div className='usub'>{card.isPuro?'PURO':card.line}{card.note?' · '+card.note:''}</div>
        {isGnd&&<div style={{fontSize:8,marginTop:2,background:'rgba(0,0,0,.15)',borderRadius:3,padding:'1px 4px',display:'inline-block',fontWeight:700}}>🔴{isGnd.reason}</div>}
        {hasTom&&!card.goingOut&&<div style={{marginTop:3,background:'#fff7ed',border:'1px solid #f59e0b',borderRadius:3,padding:'2px 5px',fontSize:8,color:'#92400e',fontWeight:700}}>📅 TMR{hasTom.hold?' · 🔴HOLD':''}</div>}
        {card.goingOut&&<div className='go-strip'>🚀 GOING OUT</div>}
        <div className='qa-row' onClick={e=>e.stopPropagation()}>
          <button className={`qa-go ${card.goingOut?'on':''}`} onClick={()=>markGoingOut(card.id)}>{card.goingOut?'✓ Out':'🚀 Out'}</button>
          {card.goingOut&&<button className='qa-btn' style={{background:'#eff6ff',color:'#2563eb'}} onClick={()=>openWentOut(card)}>📋 Went</button>}
          {!card.goingOut&&!card.awaitingArrival&&<button className='qa-btn' style={{background:'#4c1d95',color:'#c4b5fd'}} onClick={()=>{setHikeOutMod({unitId:card.id,unit:card.unit,tt:card.tt});setHikeOutDest('')}}>↑ Hike</button>}
          {!card.awaitingArrival&&<button className='qa-btn' style={{background:'#14532d',color:'#86efac'}} onClick={()=>{setHikeInMod({unitId:card.id,unit:card.unit,tt:card.tt});setHikeInFrom('')}}>↓ Hike</button>}
          {!isGnd&&<button className='qa-btn' style={{background:'#fee2e2',color:'#dc2626',border:'none'}} onClick={()=>openModal('ground_quick',card.tt,{unitId:card.id,unit:card.unit,tt:card.tt})}>🔧 Gnd</button>}
        </div>
        <button className='xcbtn' onClick={e=>{e.stopPropagation();setS(s=>({...s,units:s.units.filter(u=>u.id!==card.id)}))}}>✕</button>
      </div>
    )
  }

  const ResoCard = ({ card, tt }) => {
    const d=daysUntil(card.returnDate),overdue=d!==null&&d<0,urgent=d===0,soon=d===1
    const cdColor=overdue||urgent?'#ef4444':soon?'#f59e0b':'#475569'
    return (
      <div className={`reso-card ${urgent||overdue?'r-urgent':soon?'r-soon':''}`} onClick={()=>openModal('reso',tt,card)}>
        <div style={{fontSize:13,fontWeight:700,color:'#93c5fd'}}>{card.unit}</div>
        {card.customer&&<div style={{fontSize:9,color:'#7dd3fc',marginTop:1}}>{card.customer}</div>}
        {card.returnDate&&<div style={{fontSize:9,color:cdColor,marginTop:2,fontWeight:700}}>{overdue?`${Math.abs(d)}d OVERDUE`:urgent?'Due TODAY':soon?'Due TOMORROW':`Back ${fmtDate(card.returnDate)}`}</div>}
        <button onClick={e=>{e.stopPropagation();checkInFromReso(tt,card)}} className='ci-btn'>✅ Returned</button>
        <button className='xcbtn' onClick={e=>{e.stopPropagation();setS(s=>({...s,reso:{...s.reso,[tt]:s.reso[tt].filter(c=>c.id!==card.id)}}))}}>✕</button>
      </div>
    )
  }

  const TABS = [['dash','📋 Dashboard'],['pm','🔧 PM'],['ground','🔴 Ground'],['puro','🟣 Puro'],['hikes','✈️ Hikes'],['other','📤 Sent/CI'],['tasks','✅ Tasks'],['contacts','📞 Contacts'],['ownership','📋 Ownership']]

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div style={{fontFamily:"'Inter',sans-serif",minHeight:'100vh',background:'#fdf2f4',color:'#1a1a2e'}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Bebas+Neue&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:5px;height:5px;}::-webkit-scrollbar-thumb{background:#f3c0c8;border-radius:4px;}
        input,select,textarea{background:#fff;border:1.5px solid #f3c0c8;color:#1a1a2e;border-radius:8px;padding:8px 12px;font-family:inherit;font-size:13px;width:100%;outline:none;transition:border .15s;}
        input:focus,select:focus,textarea:focus{border-color:#e11d48;box-shadow:0 0 0 3px rgba(225,29,72,.1);}
        select option{background:#fff;} textarea{resize:vertical;min-height:52px;}
        .btn{cursor:pointer;border:none;border-radius:8px;font-family:inherit;font-size:12px;font-weight:600;padding:8px 16px;transition:all .15s;}
        .btn-amber{background:#f59e0b;color:#fff;}.btn-amber:hover{background:#d97706;}
        .btn-ghost{background:#fff;color:#6b4c52;border:1.5px solid #f3c0c8;}.btn-ghost:hover{border-color:#e11d48;color:#e11d48;}
        .btn-green{background:#16a34a;color:#fff;}.btn-green:hover{background:#15803d;}
        .btn-red{background:#fee2e2;color:#dc2626;border:1.5px solid #fca5a5;}
        .btn-sm{padding:5px 12px;font-size:11px;}
        .overlay{position:fixed;inset:0;background:rgba(100,20,40,.5);backdrop-filter:blur(4px);z-index:100;display:flex;align-items:center;justify-content:center;padding:16px;}
        .modal{background:#fff;border:1.5px solid #f3c0c8;border-radius:16px;padding:24px;width:100%;max-width:440px;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(225,29,72,.15);}
        .field{display:flex;flex-direction:column;gap:5px;margin-bottom:14px;}
        .field label{font-size:10px;color:#9c6b75;letter-spacing:.1em;text-transform:uppercase;font-weight:600;}
        .row2{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
        .sec-title{font-family:'Bebas Neue',sans-serif;letter-spacing:.08em;font-size:22px;margin-bottom:4px;}
        .sec-sub{font-size:11px;color:#9c6b75;margin-bottom:10px;}
        .grid{display:grid;grid-template-columns:repeat(10,minmax(110px,1fr));gap:2px;background:#f9d5dc;border:1.5px solid #f3c0c8;border-radius:12px;overflow:hidden;}
        .col-hdr{font-size:9px;color:#9c6b75;text-transform:uppercase;letter-spacing:.07em;text-align:center;padding:6px 4px;border-bottom:1.5px solid #f3c0c8;background:#fff0f3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600;}
        .bcol{background:#fdf2f4;padding:7px;min-height:110px;display:flex;flex-direction:column;gap:6px;}
        .ucard{border-radius:10px;padding:8px 9px 6px;cursor:pointer;position:relative;transition:transform .15s,box-shadow .15s;box-shadow:0 2px 6px rgba(0,0,0,.08);}
        .ucard:hover{transform:translateY(-2px);box-shadow:0 6px 18px rgba(0,0,0,.12);}
        .ucard-go{outline:2px solid #f97316!important;box-shadow:0 0 12px rgba(249,115,22,.35)!important;}
        .unum{font-size:13px;font-weight:700;line-height:1.2;}
        .pm-b{text-decoration:underline dotted;text-underline-offset:2px;}
        .usub{font-size:9px;opacity:.75;margin-top:2px;line-height:1.3;}
        .go-strip{margin-top:5px;background:#fff7ed;border:1px solid #f97316;border-radius:4px;padding:2px 6px;font-size:8px;color:#c2410c;font-weight:700;}
        .qa-row{display:flex;gap:3px;margin-top:6px;flex-wrap:wrap;}
        .qa-go{border:1px solid #fed7aa;border-radius:5px;cursor:pointer;font-size:8px;padding:3px 7px;font-family:inherit;font-weight:700;background:#fff7ed;color:#ea580c;}
        .qa-go.on{background:#f97316;color:#fff;border-color:#f97316;}
        .qa-btn{border:1px solid #bfdbfe;border-radius:5px;cursor:pointer;font-size:8px;padding:3px 7px;font-family:inherit;font-weight:700;background:#eff6ff;color:#2563eb;}
        .add-btn{background:#fff;border:2px dashed #f3c0c8;border-radius:8px;color:#f3c0c8;font-size:20px;text-align:center;cursor:pointer;padding:7px;user-select:none;transition:all .15s;}
        .add-btn:hover{border-color:#e11d48;color:#e11d48;}
        .xcbtn{position:absolute;top:4px;right:4px;background:rgba(255,255,255,.85);border:none;border-radius:4px;cursor:pointer;font-size:9px;padding:2px 5px;color:#9c6b75;font-weight:700;}
        .xcbtn:hover{color:#e11d48;}
        .tab{cursor:pointer;padding:9px 14px;font-size:12px;font-weight:600;border:none;background:transparent;color:#9c6b75;font-family:inherit;border-bottom:2.5px solid transparent;white-space:nowrap;}
        .tab.on{color:#e11d48;border-bottom:2.5px solid #e11d48;}
        .tab:hover:not(.on){color:#6b4c52;}
        .reso-card{background:#fff;border:1.5px solid #bfdbfe;border-radius:10px;padding:10px;cursor:pointer;position:relative;transition:transform .15s;box-shadow:0 2px 8px rgba(59,130,246,.08);}
        .reso-card:hover{transform:translateY(-1px);}
        .r-urgent{border-color:#fca5a5!important;box-shadow:0 0 10px rgba(239,68,68,.2)!important;}
        .r-soon{border-color:#fde68a!important;}
        .ci-btn{margin-top:7px;width:100%;background:#dcfce7;border:1.5px solid #16a34a;border-radius:6px;color:#15803d;font-size:10px;font-weight:700;padding:5px;cursor:pointer;font-family:inherit;}
        .ci-btn:hover{background:#bbf7d0;}
        .tog{display:flex;align-items:center;gap:8px;cursor:pointer;}
        .tog input[type=checkbox]{width:15px;height:15px;cursor:pointer;accent-color:#e11d48;}
        .notif{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1a1a2e;border-radius:10px;padding:11px 22px;font-size:13px;color:#fff;z-index:200;pointer-events:none;animation:fadein .2s;white-space:nowrap;box-shadow:0 4px 20px rgba(0,0,0,.3);}
        @keyframes fadein{from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
        .pm-pill{border-radius:4px;padding:2px 7px;font-size:9px;font-weight:700;display:inline-block;}
        .chk-box{width:17px;height:17px;border-radius:4px;border:2px solid #f3c0c8;background:#fff;cursor:pointer;appearance:none;flex-shrink:0;}
        .chk-box:checked{background:#e11d48;border-color:#e11d48;}
        .side-card{background:#fff;border:1.5px solid #f3c0c8;border-radius:10px;padding:10px 12px;position:relative;cursor:pointer;}
        .side-card:hover{border-color:#e11d48;}
        .tom-card{background:#fff;border:1.5px solid #fde68a;border-radius:10px;padding:8px 10px;cursor:pointer;position:relative;}
        .hold-badge{background:#fee2e2;color:#dc2626;border-radius:4px;font-size:8px;padding:2px 6px;font-weight:700;display:inline-block;margin-top:3px;}
        .hike-card{border-radius:10px;padding:12px;position:relative;}
        .hike-in{background:#f0fdf4;border:1.5px solid #86efac;}
        .hike-out{background:#fdf4ff;border:1.5px solid #d8b4fe;}
        .ai-bar{background:#1e1b2e;border:1.5px solid #7c3aed;border-radius:12px;padding:12px;margin-bottom:12px;}
        .ai-input{background:#12102a;border:1px solid #4c1d95;color:#e2e8f0;border-radius:8px;padding:8px 10px;font-size:11px;width:100%;outline:none;resize:none;font-family:'Inter',sans-serif;}
        .ai-input:focus{border-color:#a855f7;}
        .ai-preview{background:#0d1b2e;border:1px solid #1e3a5f;border-radius:8px;padding:10px;margin-top:8px;}
        .ground-card{background:#fff;border-radius:10px;padding:12px 14px;margin-bottom:8px;box-shadow:0 2px 8px rgba(0,0,0,.06);}
        .ground-urgent{border:1.5px solid #fca5a5;}
        .ground-normal{border:1.5px solid #fed7aa;}
        .ground-low{border:1.5px solid #e5e7eb;}
      `}</style>

      {/* header */}
      <div style={{borderBottom:'1px solid #1f2937',padding:'12px 18px',display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:12}}>
        <div>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:26,color:'#e11d48',letterSpacing:'.1em'}}>BRANCH OPS</div>
          <div style={{fontSize:11,color:'#9c6b75'}}>Day {S.dayNum} · {todayLabel}{!dbReady?' · syncing…':''}</div>
        </div>
        <div style={{display:'flex',gap:14,alignItems:'center',flexWrap:'wrap'}}>
          {[['Yard',totalYard,'#7dd3fc'],['Reso',totalReso,'#f59e0b'],['Tmrw',totalTom,'#fcd34d'],['Ground',S.grounds.length,'#f87171'],['PM',S.pms.length,'#fb923c'],['Hikes',S.hikes.length,'#67e8f9']].map(([l,v,c])=>(
            <div key={l} style={{textAlign:'center'}}><div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:c,lineHeight:1}}>{v}</div><div style={{fontSize:9,color:'#9c6b75',textTransform:'uppercase',letterSpacing:'.06em'}}>{l}</div></div>
          ))}
          <div style={{background:'#dcfce7',border:'1.5px solid #16a34a',borderRadius:8,padding:'4px 12px',textAlign:'center'}}>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:'#4ade80',lineHeight:1}}>{avail}</div>
            <div style={{fontSize:9,color:'#166534',textTransform:'uppercase'}}>Available</div>
          </div>
          {goingOut>0&&<div style={{textAlign:'center'}}><div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:'#f97316',lineHeight:1}}>{goingOut}</div><div style={{fontSize:9,color:'#9c6b75',textTransform:'uppercase'}}>Going Out</div></div>}
          {S.tasks.length>0&&<div style={{textAlign:'center'}}><div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:tasksDone===S.tasks.length?'#4ade80':'#a07880',lineHeight:1}}>{tasksDone}/{S.tasks.length}</div><div style={{fontSize:9,color:'#9c6b75',textTransform:'uppercase'}}>Tasks</div></div>}
        </div>
        <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
          <input style={{width:165,background:'#fff',border:'1px solid #f3c0c8',borderRadius:6,padding:'6px 12px',fontFamily:'inherit',fontSize:12,color:'#1a1a2e',outline:'none'}} placeholder='🔍 Search unit #' value={search} onChange={e=>setSearch(e.target.value)}/>
          <div style={{display:'flex',gap:5}}>
            <input style={{width:130,background:'#1c0a0a',border:'1px solid #ef444466',borderRadius:6,padding:'6px 10px',fontFamily:'inherit',fontSize:12,color:'#fca5a5',outline:'none'}} placeholder='Unit # remove' value={removeQ} onChange={e=>setRemoveQ(e.target.value)} onKeyDown={e=>e.key==='Enter'&&removeQ&&removeUnit(removeQ)}/>
            <button className='btn btn-red btn-sm' onClick={()=>removeQ&&removeUnit(removeQ)}>🗑</button>
          </div>
          <button className='btn btn-ghost btn-sm' onClick={()=>setHistOpen(true)}>📅 History</button>
          <button className='btn btn-green btn-sm' onClick={newDay}>🌅 New Day</button>
        </div>
      </div>

      {/* alerts */}
      {(returnAlerts.length>0||S.grounds.filter(g=>g.priority==='urgent').length>0)&&(
        <div style={{background:'#fff5f5',borderBottom:'2px solid #fca5a5',padding:'6px 18px',display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
          <span style={{fontSize:10,color:'#ef4444',fontWeight:700}}>⚠️ ALERTS:</span>
          {S.grounds.filter(g=>g.priority==='urgent').map(g=><span key={g.id} style={{background:'#7f1d1d',color:'#fca5a5',borderRadius:5,padding:'2px 8px',fontSize:10,fontWeight:700}}>#{g.unit} GROUNDED — {g.reason}</span>)}
          {returnAlerts.map((a,i)=><span key={i} style={{background:a.days<=0?'#fee2e2':'#fef9c3',color:a.days<=0?'#dc2626':'#ca8a04',border:`1px solid ${a.days<=0?'#fca5a5':'#fde68a'}`,borderRadius:5,padding:'2px 8px',fontSize:10,fontWeight:700}}>#{a.unit} {a.days<0?`${Math.abs(a.days)}d OVERDUE`:a.days===0?'Due TODAY':'Due TOMORROW'}</span>)}
        </div>
      )}

      {/* search results */}
      {searchResults&&(
        <div style={{background:'#fff',borderBottom:'1.5px solid #f3c0c8',padding:'10px 18px',display:'flex',gap:8,flexWrap:'wrap'}}>
          {searchResults.length===0?<span style={{fontSize:11,color:'#9c6b75'}}>No results for "{search}"</span>
            :searchResults.map((r,i)=><div key={i} style={{background:'#fdf2f4',border:'1px solid #f3c0c8',borderRadius:8,padding:'6px 10px'}}><div style={{fontSize:12,fontWeight:700}}>{r.unit}</div><div style={{fontSize:9,color:'#7a5560'}}>{r.where} · {r.tt}</div><div style={{fontSize:9,color:'#f59e0b'}}>{r.detail}</div></div>)}
        </div>
      )}

      {/* legend */}
      <div style={{padding:'5px 18px',borderBottom:'1px solid #1f2937',display:'flex',gap:10,flexWrap:'wrap',alignItems:'center'}}>
        {Object.entries(LINE).map(([k,v])=>(
          <div key={k} style={{display:'flex',alignItems:'center',gap:4}}>
            <div style={{width:8,height:8,borderRadius:2,background:v.bg}}/>
            <span style={{fontSize:9,color:'#7a5560'}}>{k} – {v.label}</span>
          </div>
        ))}
        <span style={{fontSize:9,color:'#7a5560',marginLeft:4}}>· <strong style={{textDecoration:'underline dotted'}}>underline</strong> = PM scheduled</span>
      </div>

      {/* tabs */}
      <div style={{display:'flex',padding:'0 18px',borderBottom:'1px solid #1f2937',overflowX:'auto'}}>
        {TABS.map(([id,lbl])=><button key={id} className={`tab ${tab===id?'on':''}`} onClick={()=>setTab(id)}>{lbl}</button>)}
      </div>

      {/* AI command bar (shown on all tabs) */}
      <div style={{padding:'10px 20px 0'}}>
        <div className='ai-bar'>
          <div style={{fontSize:9,color:'#a855f7',letterSpacing:'.08em',textTransform:'uppercase',marginBottom:6,fontWeight:700}}>⚡ AI Command Bar</div>
          <div style={{display:'flex',gap:8'}}>
            <textarea className='ai-input' rows={2} value={aiInput} onChange={e=>setAiInput(e.target.value)}
              onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();runAI(aiInput)}}}
              placeholder={'"Ground 529835 for CFI"  "529835 going out to John back June 20"  "Need a 26ft tomorrow hold it"  "529835 is back"  (Enter to run)'}/>
          </div>
          <div style={{display:'flex',gap:6,marginTop:6,alignItems:'center'}}>
            <button onClick={()=>runAI(aiInput)} disabled={aiLoading} style={{background:'#7c3aed',border:'none',borderRadius:6,color:'#fff',fontSize:11,fontWeight:700,padding:'6px 14px',cursor:aiLoading?'not-allowed':'pointer',fontFamily:'inherit',opacity:aiLoading?.6:1}}>
              {aiLoading?'⏳ Thinking…':'⚡ Run (Enter)'}
            </button>
            {aiHistory.length>0&&aiHistory.slice(-3).reverse().map((h,i)=>(
              <button key={i} onClick={()=>setAiInput(h.input)} style={{background:'none',border:'1px solid #4c1d95',borderRadius:5,color:'#a855f7',fontSize:9,padding:'3px 8px',cursor:'pointer',fontFamily:'inherit',overflow:'hidden',maxWidth:140,textOverflow:'ellipsis',whiteSpace:'nowrap'}}>↑ {h.input}</button>
            ))}
          </div>
          {aiPreview&&(
            <div className='ai-preview'>
              {aiPreview.type==='clarify'
                ?<><div style={{fontSize:10,color:'#f59e0b',marginBottom:6}}>❓ {aiPreview.question}</div><input placeholder='Your answer…' style={{fontSize:11}} autoFocus onKeyDown={e=>{if(e.key==='Enter'){runAI(aiPreview.input+' '+e.target.value);setAiPrev(null)}}}/></>
                :<><div style={{fontSize:10,color:'#94a3b8',marginBottom:4}}>Ready to execute:</div><div style={{fontSize:12,color:'#e2e8f0',marginBottom:8,fontWeight:600}}>{aiPreview.summary||aiPreview.type}</div><div style={{display:'flex',gap:6}}><button onClick={()=>execAI(aiPreview)} style={{background:'#16a34a',border:'none',borderRadius:5,color:'#fff',fontSize:11,fontWeight:700,padding:'5px 14px',cursor:'pointer',fontFamily:'inherit'}}>✓ Confirm</button><button onClick={()=>setAiPrev(null)} style={{background:'none',border:'1px solid #334155',borderRadius:5,color:'#64748b',fontSize:11,padding:'5px 10px',cursor:'pointer',fontFamily:'inherit'}}>Cancel</button></div></>
              }
            </div>
          )}
        </div>
      </div>

      <div style={{padding:'12px 20px 20px',overflowX:'auto'}}>

        {/* ── DASHBOARD ── */}
        {tab==='dash'&&(
          <div style={{display:'flex',flexDirection:'column',gap:24}}>
            <div>
              <div className='sec-title'>MY YARD TODAY</div>
              <div className='sec-sub'>Tap card to edit · Duplicate unit numbers are blocked · AI bar handles fast actions</div>
              <div className='grid'>
                {TRUCK_TYPES.map(tt=>(
                  <div key={tt}>
                    <div className='col-hdr'>{tt}</div>
                    <div className='bcol'>
                      {yardByTT(tt).map(c=><YardCard key={c.id} card={c}/>)}
                      <div className='add-btn' onClick={()=>openModal('yard',tt)}>+</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className='sec-title' style={{color:'#93c5fd'}}>SHORT TERM RESO</div>
              <div className='sec-sub'>Click Returned to move unit back → WL and update status</div>
              <div className='grid' style={{background:'#f0f4ff',borderColor:'#1e3a5f'}}>
                {TRUCK_TYPES.map(tt=>(
                  <div key={tt}>
                    <div className='col-hdr' style={{background:'#eef2ff',borderBottom:'1px solid #1e3a5f',color:'#1e3a5f'}}>{tt}</div>
                    <div className='bcol' style={{background:'#f0f4ff'}}>
                      {(S.reso[tt]||[]).map(c=><ResoCard key={c.id} card={c} tt={tt}/>)}
                      <div className='add-btn' style={{borderColor:'#1e3a5f',color:'#1e3a5f'}} onClick={()=>openModal('reso',tt)}>+</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className='sec-title' style={{color:'#fcd34d'}}>NEED FOR TOMORROW</div>
              <div className='sec-sub'>🔴 HOLD = reserved — do not give out</div>
              <div className='grid' style={{background:'#fff7e6',borderColor:'#78350f'}}>
                {TRUCK_TYPES.map(tt=>(
                  <div key={tt}>
                    <div className='col-hdr' style={{background:'#fff7e6',borderBottom:'1px solid #78350f',color:'#92400e'}}>{tt}</div>
                    <div className='bcol' style={{background:'#fff9f0'}}>
                      {(S.tomorrow[tt]||[]).map(card=>(
                        <div key={card.id} className='tom-card' onClick={()=>openModal('tomorrow',tt,card)}>
                          <div style={{fontSize:13,fontWeight:700,color:'#fcd34d'}}>{card.unit||tt}</div>
                          {card.note&&<div style={{fontSize:9,color:'#92400e',marginTop:1}}>{card.note}</div>}
                          {card.hold?<span className='hold-badge'>🔴 HOLD</span>:<span style={{fontSize:8,color:'#78350f',display:'inline-block',marginTop:2}}>available</span>}
                          <div style={{marginTop:4}} onClick={e=>e.stopPropagation()}>
                            <label className='tog'><input type='checkbox' checked={!!card.hold} onChange={()=>toggleHold(tt,card.id)}/><span style={{fontSize:9,color:'#92400e'}}>Hold</span></label>
                          </div>
                          <button className='xcbtn' onClick={e=>{e.stopPropagation();setS(s=>({...s,tomorrow:{...s.tomorrow,[tt]:s.tomorrow[tt].filter(c=>c.id!==card.id)}}))}}>✕</button>
                        </div>
                      ))}
                      <div className='add-btn' style={{borderColor:'#78350f',color:'#78350f'}} onClick={()=>openModal('tomorrow',tt)}>+</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Service / Shop */}
            {(()=>{
              const svc=S.units.filter(u=>(u.line==='SL'||u.line==='SHOP')&&!u.wentOut&&u.status!=='hiking-out'&&u.status!=='grounded')
              if(!svc.length)return null
              return(
                <div>
                  <div className='sec-title' style={{color:'#f87171'}}>🔧 SERVICE / SHOP</div>
                  {svc.map(u=>{
                    const dl=u.shopDate?daysUntil(u.shopDate):null,ov=dl!==null&&dl<0
                    const ls=u.line==='SHOP'?LINE.SHOP:LINE.SL
                    return(
                      <div key={u.id} style={{background:'#fff',border:`1px solid ${ov?'#ef4444':'#f3c0c8'}`,borderRadius:9,padding:'10px 14px',display:'flex',alignItems:'center',gap:12,flexWrap:'wrap',marginBottom:6}}>
                        <div style={{background:ls.bg,color:ls.text,borderRadius:5,padding:'3px 10px',fontSize:11,fontWeight:700}}>{u.line}</div>
                        <div><div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:'#f87171'}}>{u.unit}</div><div style={{fontSize:9,color:'#9c6b75'}}>{u.tt}</div></div>
                        {u.note&&<div style={{fontSize:11,color:'#7a5560',flex:1}}>{u.note}</div>}
                        <input type='date' value={u.shopDate||''} onChange={e=>updateUnit(u.id,{shopDate:e.target.value})} onClick={e=>e.stopPropagation()} style={{width:130,fontSize:11,padding:'4px 8px'}}/>
                        {dl!==null&&<div style={{background:ov?'#7f1d1d':'#f3c0c8',color:ov?'#fca5a5':'#a07880',borderRadius:5,padding:'3px 10px',fontSize:11,fontWeight:700}}>{ov?`${Math.abs(dl)}d overdue`:dl===0?'Ready TODAY':`${dl}d left`}</div>}
                        <button onClick={()=>{updateUnit(u.id,{line:'SRL',note:'Fixed',shopDate:''});notify(`Unit ${u.unit} → SRL ✓`)}} style={{background:'#1e293b',border:'1px solid #94a3b8',color:'#f1f5f9',borderRadius:5,padding:'4px 10px',fontSize:10,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>✓ Fixed → SRL</button>
                      </div>
                    )
                  })}
                </div>
              )
            })()}
          </div>
        )}

        {/* ── PM TAB ── */}
        {tab==='pm'&&(
          <div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
              <div><div className='sec-title' style={{color:'#fb923c'}}>PM SCHEDULER</div><div className='sec-sub'>Advance status as unit progresses · AI auto-suggests swap unit</div></div>
              <button className='btn btn-amber btn-sm' onClick={()=>openModal('pm')}>+ Schedule PM</button>
            </div>
            {S.pms.length===0&&<div style={{color:'#e8b4bc',fontSize:12,textAlign:'center',padding:'32px 0'}}>No active PMs ✓</div>}
            {['CFI','Accident','Breakdown','Routine PM'].map(reason=>{
              const group=S.pms.filter(p=>p.reason===reason); if(!group.length)return null
              const col=reason==='CFI'||reason==='Accident'?'#ef4444':reason==='Breakdown'?'#f59e0b':'#fb923c'
              return(
                <div key={reason} style={{marginBottom:20}}>
                  <div style={{fontSize:11,color:col,textTransform:'uppercase',letterSpacing:'.08em',marginBottom:8,display:'flex',alignItems:'center',gap:8}}>
                    {reason==='CFI'||reason==='Accident'?'🚨':'🔧'} {reason}
                    <span style={{background:col,color:'#fff',borderRadius:4,padding:'0 6px',fontSize:10}}>{group.length}</span>
                  </div>
                  {group.map(pm=>{
                    const si=PM_STATUSES.indexOf(pm.status)
                    return(
                      <div key={pm.id} style={{background:'#fff',border:`1px solid ${reason==='CFI'||reason==='Accident'?'#fca5a5':'#f3c0c8'}`,borderRadius:8,padding:'12px 14px',marginBottom:6}}>
                        <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
                          <div><div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20}}>{pm.unit}</div><div style={{fontSize:9,color:'#9c6b75'}}>{pm.tt}</div></div>
                          <div style={{display:'flex',gap:3,flex:1,flexWrap:'wrap'}}>
                            {PM_STATUSES.map((st,i)=>(
                              <div key={st} className='pm-pill' style={{background:i<si?'#dcfce7':i===si?col:'#f3f4f6',color:i<si?'#15803d':i===si?'#fff':'#9ca3af',border:i===si?`1px solid ${col}`:'none'}}>{i<si?'✓':st}</div>
                            ))}
                          </div>
                          {pm.swapUnit&&<div style={{fontSize:10,color:'#1d4ed8',background:'#eff6ff',border:'1px solid #bfdbfe',borderRadius:5,padding:'3px 8px',whiteSpace:'nowrap'}}>🔄 Swap: #{pm.swapUnit}</div>}
                          <div style={{display:'flex',gap:6}}>
                            {pm.status!=='Picked Up'&&<button className='btn btn-amber btn-sm' onClick={()=>advancePM(pm.id)}>→ {PM_STATUSES[si+1]||'Done'}</button>}
                            <button className='btn btn-ghost btn-sm' onClick={()=>setS(s=>({...s,pms:s.pms.filter(p=>p.id!==pm.id)}))}>✕</button>
                          </div>
                        </div>
                        {pm.note&&<div style={{fontSize:10,color:'#9c6b75',marginTop:6}}>{pm.note}</div>}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        )}

        {/* ── GROUND UNITS ── */}
        {tab==='ground'&&(
          <div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
              <div><div className='sec-title' style={{color:'#f87171'}}>GROUND UNITS</div><div className='sec-sub'>CFI / Accident = urgent · Estimated ready date with live countdown · flags blocked resos</div></div>
              <button className='btn btn-sm' style={{background:'#fee2e2',color:'#dc2626',border:'1.5px solid #fca5a5'}} onClick={()=>openModal('ground')}>+ Ground Unit</button>
            </div>
            {S.grounds.length===0&&<div style={{color:'#e8b4bc',fontSize:12,textAlign:'center',padding:'32px 0'}}>No grounded units ✓</div>}
            {['urgent','normal','low'].map(pri=>{
              const group=S.grounds.filter(g=>g.priority===pri).sort((a,b)=>{
                const da=a.estimatedReadyDate?daysUntil(a.estimatedReadyDate):999
                const db=b.estimatedReadyDate?daysUntil(b.estimatedReadyDate):999
                return da-db
              })
              if(!group.length)return null
              const priCol=pri==='urgent'?'#ef4444':pri==='normal'?'#f59e0b':'#9ca3af'
              return(
                <div key={pri} style={{marginBottom:20}}>
                  <div style={{fontSize:10,color:priCol,textTransform:'uppercase',letterSpacing:'.08em',marginBottom:8,fontWeight:700}}>{pri==='urgent'?'🚨 URGENT':pri==='normal'?'⚠️ NORMAL':'ℹ️ ROUTINE'}</div>
                  {group.map(g=>{
                    const dl=g.estimatedReadyDate?daysUntil(g.estimatedReadyDate):null,ov=dl!==null&&dl<0
                    const blockedReso=g.blockedResoId?Object.values(S.reso).flat().find(r=>r.id===g.blockedResoId):null
                    return(
                      <div key={g.id} className={`ground-card ground-${g.priority}`}>
                        <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
                          <div>
                            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:g.priority==='urgent'?'#ef4444':'#1a1a2e'}}>{g.unit}</div>
                            <div style={{fontSize:9,color:'#9c6b75'}}>{g.tt}</div>
                          </div>
                          <div style={{background:g.priority==='urgent'?'#fee2e2':g.priority==='normal'?'#fff7ed':'#f3f4f6',color:g.priority==='urgent'?'#dc2626':g.priority==='normal'?'#ea580c':'#6b7280',borderRadius:5,padding:'3px 10px',fontSize:11,fontWeight:700}}>{g.reason}</div>
                          <div style={{display:'flex',alignItems:'center',gap:6}}>
                            <span style={{fontSize:10,color:'#9c6b75'}}>Ready:</span>
                            <input type='date' value={g.estimatedReadyDate||''} onChange={e=>updateGround(g.id,{estimatedReadyDate:e.target.value})} style={{width:130,fontSize:11,padding:'4px 8px'}}/>
                          </div>
                          {dl!==null&&<div style={{background:ov?'#7f1d1d':dl<=1?'#78350f':'#f3f4f6',color:ov?'#fca5a5':dl<=1?'#fcd34d':'#6b7280',borderRadius:4,padding:'2px 8px',fontSize:11,fontWeight:700}}>{ov?`${Math.abs(dl)}d overdue`:dl===0?'Ready TODAY':`${dl}d left`}</div>}
                          {blockedReso&&<div style={{background:'#fff5f5',border:'1px solid #fca5a5',borderRadius:5,padding:'3px 8px',fontSize:9,color:'#dc2626'}}>⚠️ Blocking reso: {blockedReso.customer||blockedReso.unit}</div>}
                          <div style={{display:'flex',gap:6,marginLeft:'auto'}}>
                            <button className='btn btn-green btn-sm' onClick={()=>returnFromGround(g.id,'SRL')}>✓ Return → SRL</button>
                            <button className='btn btn-ghost btn-sm' onClick={()=>returnFromGround(g.id,'WL')}>→ WL</button>
                            <button className='btn btn-ghost btn-sm' onClick={()=>setS(s=>({...s,grounds:s.grounds.filter(g2=>g2.id!==g.id),units:s.units.map(u=>u.id===g.unitId?{...u,status:'available'}:u)}))}>✕</button>
                          </div>
                        </div>
                        {g.note&&<div style={{fontSize:10,color:'#9c6b75',marginTop:6}}>{g.note}</div>}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        )}

        {/* ── PURO ── */}
        {tab==='puro'&&(()=>{
          const pYard=S.units.filter(u=>u.isPuro&&!u.wentOut)
          const pReso=Object.values(S.reso).flat().filter(r=>S.units.find(u=>u.unit===r.unit&&u.isPuro))
          return(
            <div>
              <div className='sec-title' style={{color:'#a855f7'}}>PUROLATOR FLEET</div>
              <div style={{marginTop:12}}>
                <div style={{fontSize:11,color:'#6b21a8',marginBottom:8,fontWeight:600}}>On Yard ({pYard.length})</div>
                <div style={{display:'flex',flexWrap:'wrap',gap:8,marginBottom:20}}>
                  {pYard.map(u=><div key={u.id} style={{background:'#fce7ef',border:'1px solid #7c3aed',borderRadius:8,padding:'10px 14px',minWidth:120}}><div style={{fontSize:15,fontWeight:700,color:'#c4b5fd'}}>{u.unit}</div><div style={{fontSize:9,color:'#6b21a8'}}>{u.tt} · {u.line}</div>{u.note&&<div style={{fontSize:9,color:'#9c6b75',marginTop:2}}>{u.note}</div>}</div>)}
                  {pYard.length===0&&<div style={{color:'#e8b4bc',fontSize:11}}>None on yard</div>}
                </div>
                <div style={{fontSize:11,color:'#6b21a8',marginBottom:8,fontWeight:600}}>In Reso ({pReso.length})</div>
                <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
                  {pReso.map(r=><div key={r.id} style={{background:'#0f0a1e',border:'1px solid #4c1d95',borderRadius:8,padding:'10px 14px',minWidth:120}}><div style={{fontSize:15,fontWeight:700,color:'#a78bfa'}}>{r.unit}</div><div style={{fontSize:9,color:'#6b21a8'}}>Back {fmtDate(r.returnDate)}</div></div>)}
                  {pReso.length===0&&<div style={{color:'#e8b4bc',fontSize:11}}>None in reso</div>}
                </div>
              </div>
            </div>
          )
        })()}

        {/* ── HIKES ── */}
        {tab==='hikes'&&(
          <div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
              <div><div className='sec-title' style={{color:'#67e8f9'}}>HIKE TRACKER</div><div className='sec-sub'>↓ Inbound · ↑ Outbound · Unit status syncs automatically</div></div>
              <button className='btn btn-amber btn-sm' onClick={()=>openModal('hike')}>+ Add Hike</button>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:20,marginBottom:24}}>
              {['in','out'].map(dir=>(
                <div key={dir}>
                  <div style={{fontSize:11,color:dir==='in'?'#4ade80':'#c084fc',fontWeight:700,textTransform:'uppercase',letterSpacing:'.05em',marginBottom:8}}>{dir==='in'?'↓ Inbound':'↑ Outbound'}</div>
                  {S.hikes.filter(h=>h.dir===dir).length===0&&<div style={{color:'#e8b4bc',fontSize:11}}>None</div>}
                  <div style={{display:'flex',flexDirection:'column',gap:6}}>
                    {S.hikes.filter(h=>h.dir===dir).map(h=>(
                      <div key={h.id} className={`hike-card hike-${dir}`}>
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                          <div><span style={{fontSize:15,fontWeight:700,color:dir==='in'?'#4ade80':'#c084fc'}}>{h.unit}</span><span style={{fontSize:9,marginLeft:6,color:dir==='in'?'#166534':'#6b21a8'}}>{dir==='in'?'↓ IN':'↑ OUT'}</span></div>
                          <button style={{background:'none',border:'none',color:'#9c6b75',cursor:'pointer',fontSize:10,fontWeight:700}} onClick={()=>setS(s=>({...s,hikes:s.hikes.filter(x=>x.id!==h.id)}))}>✕</button>
                        </div>
                        <div style={{fontSize:9,color:'#7a5560',marginTop:3}}>{h.tt}</div>
                        {h.location&&<div style={{fontSize:10,color:'#6b4c52',marginTop:2}}>{dir==='in'?'From':'To'}: {h.location}</div>}
                        {h.arrival&&<div style={{fontSize:10,color:'#f59e0b',marginTop:2}}>📅 {fmtDate(h.arrival)}</div>}
                        {dir==='in'&&(
                          <button onClick={()=>{const u=S.units.find(u2=>u2.unit===h.unit);if(u)confirmArrival(u);setS(s=>({...s,hikes:s.hikes.filter(h2=>h2.id!==h.id)}))}} style={{marginTop:6,width:'100%',background:'#dcfce7',border:'1.5px solid #16a34a',borderRadius:5,color:'#15803d',fontSize:9,fontWeight:700,padding:'3px 0',cursor:'pointer',fontFamily:'inherit'}}>✅ Arrived</button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {Object.keys(S.branchHikeHistory).length>0&&(
              <div>
                <div className='sec-title' style={{color:'#67e8f9',fontSize:18}}>BRANCH HISTORY</div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))',gap:8,marginTop:10}}>
                  {Object.entries(S.branchHikeHistory).map(([branch,c])=>(
                    <div key={branch} style={{background:'#fff',border:'1.5px solid #f3c0c8',borderRadius:8,padding:'10px 12px'}}>
                      <div style={{fontSize:12,fontWeight:700,marginBottom:6}}>{branch}</div>
                      <div style={{display:'flex',gap:14}}>
                        <div style={{textAlign:'center'}}><div style={{fontSize:18,fontWeight:700,color:'#4ade80'}}>{c.in||0}</div><div style={{fontSize:8,color:'#9c6b75'}}>IN ↓</div></div>
                        <div style={{textAlign:'center'}}><div style={{fontSize:18,fontWeight:700,color:'#c084fc'}}>{c.out||0}</div><div style={{fontSize:8,color:'#9c6b75'}}>OUT ↑</div></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── SENT & CI ── */}
        {tab==='other'&&(
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:20,maxWidth:800}}>
            <div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
                <div className='sec-title' style={{fontSize:17,color:'#a78bfa'}}>NON-REV'D</div>
                <button className='btn btn-amber btn-sm' onClick={()=>openModal('sent')}>+ Add</button>
              </div>
              {S.sent.length===0&&<div style={{color:'#e8b4bc',fontSize:11}}>None sent out</div>}
              <div style={{display:'flex',flexDirection:'column',gap:6}}>
                {S.sent.map(c=>(
                  <div key={c.id} className='side-card' onClick={()=>openModal('sent',null,c)}>
                    <div style={{display:'flex',justifyContent:'space-between'}}><span style={{fontSize:13,fontWeight:700,color:'#a78bfa'}}>{c.unit}</span><span style={{fontSize:9,color:'#7a5560'}}>{c.tt}</span></div>
                    {c.location&&<div style={{fontSize:10,color:'#7c3aed',marginTop:2}}>→ {c.location}</div>}
                    {c.note&&<div style={{fontSize:9,color:'#9c6b75',marginTop:2}}>{c.note}</div>}
                    <button className='xcbtn' onClick={e=>{e.stopPropagation();setS(s=>({...s,sent:s.sent.filter(s2=>s2.id!==c.id)}))}}>✕</button>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
                <div className='sec-title' style={{fontSize:17,color:'#34d399'}}>CHECK IN'S</div>
                <button className='btn btn-amber btn-sm' onClick={()=>openModal('checkin')}>+ Add</button>
              </div>
              {S.checkins.length===0&&<div style={{color:'#e8b4bc',fontSize:11}}>No check-ins</div>}
              <div style={{display:'flex',flexDirection:'column',gap:6}}>
                {S.checkins.map(c=>(
                  <div key={c.id} className='side-card' style={{borderColor:'#064e3b'}} onClick={()=>openModal('checkin',null,c)}>
                    <div style={{display:'flex',justifyContent:'space-between'}}><span style={{fontSize:13,fontWeight:700,color:'#34d399'}}>{c.unit}</span><span style={{fontSize:9,color:'#7a5560'}}>{c.tt}</span></div>
                    {c.hikedFrom&&<div style={{fontSize:10,color:'#059669',marginTop:2}}>✈️ From: {c.hikedFrom}</div>}
                    <button className='xcbtn' onClick={e=>{e.stopPropagation();setS(s=>({...s,checkins:s.checkins.filter(c2=>c2.id!==c.id)}))}}>✕</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── TASKS ── */}
        {tab==='tasks'&&(
          <div style={{maxWidth:600}}>
            <div className='sec-title' style={{color:'#a3e635',marginBottom:4}}>DAILY TASKS</div>
            <div style={{display:'flex',gap:8,marginBottom:16}}>
              <input placeholder='Add a task…' value={taskInput} onChange={e=>setTaskInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){addTask(taskInput);setTaskInput('')}}}/>
              <button className='btn btn-amber' style={{flexShrink:0,padding:'8px 14px'}} onClick={()=>{addTask(taskInput);setTaskInput('')}}>Add</button>
            </div>
            {S.tasks.length===0&&<div style={{color:'#e8b4bc',fontSize:12,textAlign:'center',padding:'20px 0'}}>No tasks yet</div>}
            {[['return','⚠️ Return Reminders','#f59e0b'],['checkin','✅ Check-in Tasks','#34d399'],['hike-arrive','✈️ Arrivals','#67e8f9'],['general','General','#a07880']].map(([type,label,color])=>{
              const group=S.tasks.filter(t=>t.type===type); if(!group.length)return null
              return(
                <div key={type} style={{marginBottom:16}}>
                  <div style={{fontSize:10,color,textTransform:'uppercase',letterSpacing:'.08em',marginBottom:6}}>{label}</div>
                  {group.map(t=>(
                    <div key={t.id} style={{display:'flex',alignItems:'flex-start',gap:10,padding:'8px 0',borderBottom:'1px solid #1f2937'}}>
                      <input type='checkbox' className='chk-box' checked={t.done} onChange={()=>toggleTask(t.id)}/>
                      <div style={{flex:1,fontSize:13,color:t.done?'#e8b4bc':'#1a1a2e',textDecoration:t.done?'line-through':'none'}}>
                        {t.unit&&<span style={{color:'#f59e0b',marginRight:5,fontWeight:700}}>#{t.unit}</span>}{t.text}
                      </div>
                      <button style={{background:'none',border:'none',color:'#e8b4bc',cursor:'pointer',fontSize:11}} onClick={()=>delTask(t.id)}>✕</button>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        )}

        {/* ── CONTACTS ── */}
        {tab==='contacts'&&(
          <div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
              <div className='sec-title' style={{color:'#7dd3fc'}}>CONTACTS</div>
              <button className='btn btn-ghost btn-sm' onClick={()=>openModal('contact')}>+ Add Contact</button>
            </div>
            {S.contacts.length===0&&<div style={{color:'#e8b4bc',fontSize:12,textAlign:'center',padding:'32px 0'}}>No contacts yet</div>}
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))',gap:8}}>
              {S.contacts.map(c=>(
                <div key={c.id} style={{background:'#fff',border:'1.5px solid #f3c0c8',borderRadius:8,padding:'12px 14px',position:'relative'}}>
                  <div style={{fontSize:13,fontWeight:700,color:'#1d4ed8'}}>{c.name}</div>
                  {c.branch&&<div style={{fontSize:10,color:'#9c6b75'}}>{c.branch}</div>}
                  {c.phone&&<div style={{fontSize:11,color:'#1a1a2e',marginTop:4}}>📞 {c.phone}</div>}
                  {c.notes&&<div style={{fontSize:10,color:'#9c6b75',marginTop:4,fontStyle:'italic'}}>{c.notes}</div>}
                  <button className='xcbtn' onClick={()=>setS(s=>({...s,contacts:s.contacts.filter(c2=>c2.id!==c.id)}))}>✕</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── OWNERSHIP ── */}
        {tab==='ownership'&&(
          <div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
              <div className='sec-title' style={{color:'#94a3b8'}}>FLEET OWNERSHIP</div>
              <button className='btn btn-ghost btn-sm' onClick={()=>openModal('ownership')}>+ Add Record</button>
            </div>
            {S.ownership.length===0&&<div style={{color:'#e8b4bc',fontSize:12,textAlign:'center',padding:'32px 0'}}>No ownership records</div>}
            <div style={{display:'flex',flexDirection:'column',gap:6}}>
              {S.ownership.map(o=>(
                <div key={o.id} style={{background:'#fff',border:'1.5px solid #f3c0c8',borderRadius:8,padding:'10px 14px',display:'flex',alignItems:'center',gap:12,position:'relative'}}>
                  <div style={{fontSize:14,fontWeight:700}}>{o.unit}</div>
                  <div style={{fontSize:11,color:'#9c6b75'}}>{o.tt}</div>
                  <div style={{background:o.owned?'#dcfce7':'#fef9c3',color:o.owned?'#15803d':'#ca8a04',borderRadius:4,padding:'2px 8px',fontSize:10,fontWeight:700}}>{o.owned?'OWNED':'LEASED'}</div>
                  {o.notes&&<div style={{fontSize:10,color:'#9c6b75'}}>{o.notes}</div>}
                  <button className='xcbtn' onClick={()=>setS(s=>({...s,ownership:s.ownership.filter(o2=>o2.id!==o.id)}))}>✕</button>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>

      {/* ── MODALS ── */}
      {modal&&(
        <div className='overlay' onClick={closeModal}>
          <div className='modal' onClick={e=>e.stopPropagation()}>

            {/* yard / add unit */}
            {(modal.type==='yard')&&<>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:17,color:'#f59e0b',marginBottom:14}}>{modal.card?'EDIT':'ADD'} UNIT — {modal.tt}</div>
              {!modal.card&&form.unit&&findUnit(form.unit)&&<div style={{background:'#fee2e2',border:'1px solid #fca5a5',borderRadius:6,padding:'8px 10px',fontSize:11,color:'#dc2626',marginBottom:12}}>⚠️ Unit {form.unit} already exists on {findUnit(form.unit).tt} — saving blocked</div>}
              <div className='row2'>
                <div className='field'><label>Unit #</label><input placeholder='e.g. 529835' value={form.unit||''} onChange={sf('unit')}/></div>
                <div className='field'><label>Line</label><select value={form.line||'RL'} onChange={sf('line')}><option value='RL'>RL – Ready Line</option><option value='WL'>WL – Wash Line</option><option value='SRL'>SRL – Service Ready</option><option value='SL'>SL – Service Line</option><option value='SHOP'>SHOP – Shop/Deadline</option></select></div>
              </div>
              <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:12}}>
                {[['isPuro','Purolator','#a855f7'],['addTomorrow','📅 Tomorrow','#fcd34d'],['addPM','🔧 PM Due','#fb923c']].map(([k,l,c])=>(
                  <label key={k} className='tog' style={{background:'#fff',border:'1px solid #f3c0c8',borderRadius:6,padding:'6px 10px',cursor:'pointer'}}>
                    <input type='checkbox' checked={!!form[k]} onChange={sf(k)}/>
                    <span style={{fontSize:11,color:form[k]?c:'#a07880'}}>{l}</span>
                  </label>
                ))}
              </div>
              {form.line==='SHOP'&&<div className='field'><label>Expected Out</label><input type='date' value={form.shopDate||''} onChange={sf('shopDate')}/></div>}
              <div className='field'><label>Note</label><textarea value={form.note||''} onChange={sf('note')}/></div>
              <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                <button className='btn btn-ghost' onClick={closeModal}>Cancel</button>
                <button className='btn btn-amber' onClick={saveUnit}>{modal.card?'Save Changes':'Add Unit'}</button>
              </div>
            </>}

            {/* reso */}
            {modal.type==='reso'&&<>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:17,color:'#93c5fd',marginBottom:14}}>{modal.card?'EDIT':'ADD'} RESO — {modal.tt}</div>
              <div className='field'><label>Unit #</label><input value={form.unit||''} onChange={sf('unit')}/></div>
              <div className='field'><label>Customer</label><input value={form.customer||''} onChange={sf('customer')}/></div>
              <div className='field'><label>Return Date</label><input type='date' value={form.returnDate||''} onChange={sf('returnDate')}/></div>
              <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                <button className='btn btn-ghost' onClick={closeModal}>Cancel</button>
                <button className='btn btn-amber' onClick={()=>{
                  if(!form.unit?.trim())return
                  const card={id:form.id||uid(),unit:form.unit.trim(),customer:form.customer||'',returnDate:form.returnDate||'',note:''}
                  const tt=modal.tt
                  setS(s=>({...s,reso:{...s.reso,[tt]:modal.card?s.reso[tt].map(c=>c.id===card.id?card:c):[...(s.reso[tt]||[]),card]}}))
                  closeModal()
                }}>{modal.card?'Save':'Add'}</button>
              </div>
            </>}

            {/* tomorrow */}
            {modal.type==='tomorrow'&&<>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:17,color:'#fcd34d',marginBottom:14}}>{modal.card?'EDIT':'ADD'} TOMORROW — {modal.tt}</div>
              <div className='field'><label>Unit # (optional)</label><input value={form.unit||''} onChange={sf('unit')}/></div>
              <label className='tog' style={{marginBottom:12}}><input type='checkbox' checked={!!form.hold} onChange={sf('hold')}/><span style={{fontSize:12,color:'#fca5a5'}}>🔴 Hold — do not give out</span></label>
              <div className='field'><label>Note</label><textarea value={form.note||''} onChange={sf('note')}/></div>
              <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                <button className='btn btn-ghost' onClick={closeModal}>Cancel</button>
                <button className='btn btn-amber' onClick={()=>{
                  const card={id:form.id||uid(),unit:form.unit||'',hold:!!form.hold,note:form.note||''}
                  const tt=modal.tt
                  setS(s=>({...s,tomorrow:{...s.tomorrow,[tt]:modal.card?s.tomorrow[tt].map(c=>c.id===card.id?card:c):[...(s.tomorrow[tt]||[]),card]}}))
                  closeModal()
                }}>{modal.card?'Save':'Add'}</button>
              </div>
            </>}

            {/* pm */}
            {modal.type==='pm'&&<>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:17,color:'#fb923c',marginBottom:14}}>{modal.card?'EDIT':'SCHEDULE'} PM</div>
              <div className='row2'>
                <div className='field'><label>Unit #</label><input value={form.unit||''} onChange={sf('unit')}/></div>
                <div className='field'><label>Truck Type</label><select value={form.tt||''} onChange={sf('tt')}><option value=''>Select…</option>{TRUCK_TYPES.map(t=><option key={t} value={t}>{t}</option>)}</select></div>
              </div>
              <div className='field'><label>Reason</label><select value={form.reason||'Routine PM'} onChange={sf('reason')}>{PM_REASONS.map(r=><option key={r} value={r}>{r}</option>)}</select></div>
              <div className='field'><label>Note</label><textarea value={form.note||''} onChange={sf('note')}/></div>
              <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                <button className='btn btn-ghost' onClick={closeModal}>Cancel</button>
                <button className='btn btn-amber' onClick={()=>{
                  const u=findUnit(form.unit)
                  if(!u){notify('Unit not found on yard');return}
                  schedulePM(u.id,form.reason||'Routine PM',form.note||'')
                  closeModal()
                }}>Schedule</button>
              </div>
            </>}

            {/* ground */}
            {(modal.type==='ground'||modal.type==='ground_quick')&&<>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:17,color:'#ef4444',marginBottom:14}}>GROUND UNIT{modal.card?.unit?` — #${modal.card.unit}`:''}</div>
              {!modal.card?.unit&&<div className='row2'><div className='field'><label>Unit #</label><input value={form.unit||''} onChange={sf('unit')}/></div><div className='field'><label>Truck Type</label><select value={form.tt||''} onChange={sf('tt')}><option value=''>Select…</option>{TRUCK_TYPES.map(t=><option key={t} value={t}>{t}</option>)}</select></div></div>}
              <div className='field'><label>Reason</label><select value={form.reason||'CFI'} onChange={sf('reason')}>{GROUND_REASONS.map(r=><option key={r} value={r}>{r}</option>)}</select></div>
              <div className='field'><label>Estimated Ready Date</label><input type='date' value={form.estimatedReadyDate||''} onChange={sf('estimatedReadyDate')}/></div>
              <div className='field'><label>Note</label><textarea value={form.note||''} onChange={sf('note')}/></div>
              <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                <button className='btn btn-ghost' onClick={closeModal}>Cancel</button>
                <button className='btn btn-red' onClick={()=>{
                  const uid2=modal.card?.unitId||findUnit(form.unit||modal.card?.unit)?.id
                  if(!uid2){notify('Unit not found');return}
                  groundUnit(uid2,form.reason||'CFI',form.estimatedReadyDate||'',form.note||'')
                  closeModal()
                }}>Ground Unit</button>
              </div>
            </>}

            {/* hike */}
            {modal.type==='hike'&&<>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:17,color:'#67e8f9',marginBottom:14}}>{modal.card?'EDIT':'ADD'} HIKE</div>
              <div className='row2'>
                <div className='field'><label>Unit #</label><input value={form.unit||''} onChange={sf('unit')}/></div>
                <div className='field'><label>Direction</label><select value={form.dir||'in'} onChange={sf('dir')}><option value='in'>↓ Inbound</option><option value='out'>↑ Outbound</option></select></div>
              </div>
              <div className='row2'>
                <div className='field'><label>Truck Type</label><select value={form.tt||''} onChange={sf('tt')}><option value=''>Select…</option>{TRUCK_TYPES.map(t=><option key={t} value={t}>{t}</option>)}</select></div>
                <div className='field'><label>{form.dir==='out'?'To':'From'} Location</label><input value={form.location||''} onChange={sf('location')}/></div>
              </div>
              <div className='field'><label>Expected Date</label><input type='date' value={form.arrival||''} onChange={sf('arrival')}/></div>
              <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                <button className='btn btn-ghost' onClick={closeModal}>Cancel</button>
                <button className='btn btn-amber' onClick={()=>{
                  if(!form.unit?.trim())return
                  const u=findUnit(form.unit)
                  if(form.dir==='out'&&u){setHikeOutMod({unitId:u.id,unit:u.unit,tt:u.tt});setHikeOutDest(form.location||'');closeModal();return}
                  if(form.dir==='in'&&u){setHikeInMod({unitId:u.id,unit:u.unit,tt:u.tt});setHikeInFrom(form.location||'');closeModal();return}
                  const hike={id:uid(),unit:form.unit.trim(),tt:form.tt||'',dir:form.dir||'in',location:form.location||'',arrival:form.arrival||'',placed:false,ready:false,pmDue:false,note:''}
                  setS(s=>({...s,hikes:[...s.hikes,hike]}))
                  closeModal()
                }}>{modal.card?'Save':'Add Hike'}</button>
              </div>
            </>}

            {/* sent */}
            {modal.type==='sent'&&<>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:17,color:'#a78bfa',marginBottom:14}}>{modal.card?'EDIT':'ADD'} NON-REV'D</div>
              <div className='row2'>
                <div className='field'><label>Unit #</label><input value={form.unit||''} onChange={sf('unit')}/></div>
                <div className='field'><label>Truck Type</label><select value={form.tt||''} onChange={sf('tt')}><option value=''>Select…</option>{TRUCK_TYPES.map(t=><option key={t} value={t}>{t}</option>)}</select></div>
              </div>
              <div className='field'><label>Sent To</label><input value={form.location||''} onChange={sf('location')}/></div>
              <div className='field'><label>Note</label><textarea value={form.note||''} onChange={sf('note')}/></div>
              <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                <button className='btn btn-ghost' onClick={closeModal}>Cancel</button>
                <button className='btn btn-amber' onClick={()=>{
                  if(!form.unit?.trim())return
                  const card={id:form.id||uid(),unit:form.unit.trim(),tt:form.tt||'',location:form.location||'',note:form.note||''}
                  setS(s=>({...s,sent:modal.card?s.sent.map(c=>c.id===card.id?card:c):[...s.sent,card]}))
                  closeModal()
                }}>{modal.card?'Save':'Add'}</button>
              </div>
            </>}

            {/* checkin */}
            {modal.type==='checkin'&&<>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:17,color:'#34d399',marginBottom:14}}>{modal.card?'EDIT':'ADD'} CHECK IN</div>
              <div className='row2'>
                <div className='field'><label>Unit #</label><input value={form.unit||''} onChange={sf('unit')}/></div>
                <div className='field'><label>Truck Type</label><select value={form.tt||''} onChange={sf('tt')}><option value=''>Select…</option>{TRUCK_TYPES.map(t=><option key={t} value={t}>{t}</option>)}</select></div>
              </div>
              <div className='field'><label>Hiked From</label><input placeholder='e.g. Concord' value={form.hikedFrom||''} onChange={sf('hikedFrom')}/></div>
              <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                <button className='btn btn-ghost' onClick={closeModal}>Cancel</button>
                <button className='btn btn-amber' onClick={()=>{
                  if(!form.unit?.trim())return
                  const card={id:form.id||uid(),unit:form.unit.trim(),tt:form.tt||'',hikedFrom:form.hikedFrom||'',note:''}
                  setS(s=>({...s,checkins:modal.card?s.checkins.map(c=>c.id===card.id?card:c):[...s.checkins,card]}))
                  closeModal(); notify(`Check-in added ✓`)
                }}>{modal.card?'Save':'Add'}</button>
              </div>
            </>}

            {/* contact */}
            {modal.type==='contact'&&<>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:17,color:'#7dd3fc',marginBottom:14}}>ADD CONTACT</div>
              <div className='field'><label>Name</label><input value={form.name||''} onChange={sf('name')}/></div>
              <div className='field'><label>Branch</label><input value={form.branch||''} onChange={sf('branch')}/></div>
              <div className='field'><label>Phone</label><input value={form.phone||''} onChange={sf('phone')}/></div>
              <div className='field'><label>Notes</label><textarea value={form.notes||''} onChange={sf('notes')}/></div>
              <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                <button className='btn btn-ghost' onClick={closeModal}>Cancel</button>
                <button className='btn btn-amber' onClick={()=>{
                  if(!form.name?.trim())return
                  setS(s=>({...s,contacts:[...s.contacts,{id:uid(),name:form.name.trim(),branch:form.branch||'',phone:form.phone||'',notes:form.notes||''}]}))
                  closeModal()
                }}>Add</button>
              </div>
            </>}

            {/* ownership */}
            {modal.type==='ownership'&&<>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:17,color:'#94a3b8',marginBottom:14}}>ADD OWNERSHIP</div>
              <div className='row2'>
                <div className='field'><label>Unit #</label><input value={form.unit||''} onChange={sf('unit')}/></div>
                <div className='field'><label>Truck Type</label><select value={form.tt||''} onChange={sf('tt')}><option value=''>Select…</option>{TRUCK_TYPES.map(t=><option key={t} value={t}>{t}</option>)}</select></div>
              </div>
              <label className='tog' style={{marginBottom:12}}><input type='checkbox' checked={!!form.owned} onChange={sf('owned')}/><span style={{fontSize:12,color:'#4ade80'}}>Owned (unchecked = Leased)</span></label>
              <div className='field'><label>Notes</label><textarea value={form.notes||''} onChange={sf('notes')}/></div>
              <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                <button className='btn btn-ghost' onClick={closeModal}>Cancel</button>
                <button className='btn btn-amber' onClick={()=>{
                  if(!form.unit?.trim())return
                  setS(s=>({...s,ownership:[...s.ownership,{id:uid(),unit:form.unit.trim(),tt:form.tt||'',owned:!!form.owned,notes:form.notes||''}]}))
                  closeModal()
                }}>Add</button>
              </div>
            </>}

          </div>
        </div>
      )}

      {/* went out modal */}
      {goModal&&(
        <div className='overlay' onClick={()=>setGoModal(null)}>
          <div className='modal' style={{background:'#fff7ed',border:'1px solid #f97316',maxWidth:360}} onClick={e=>e.stopPropagation()}>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:'#f97316',marginBottom:4}}>WENT OUT — #{goModal.unit}</div>
            <div style={{fontSize:10,color:'#92400e',marginBottom:16}}>{goModal.tt} · unit removed from yard · added to Reso</div>
            <div className='field'><label>Customer</label><input value={goForm.customer} onChange={e=>setGoForm(f=>({...f,customer:e.target.value}))}/></div>
            <div className='field'><label>Return Date (default 2 weeks)</label><input type='date' value={goForm.returnDate} onChange={e=>setGoForm(f=>({...f,returnDate:e.target.value}))}/></div>
            <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button className='btn btn-ghost' onClick={()=>setGoModal(null)}>Cancel</button>
              <button className='btn' style={{background:'#ea580c',color:'#fff'}} onClick={confirmWentOut}>Confirm Went Out</button>
            </div>
          </div>
        </div>
      )}

      {/* hike in modal */}
      {hikeInMod&&(
        <div className='overlay' onClick={()=>setHikeInMod(null)}>
          <div className='modal' style={{background:'#f0fff4',border:'1px solid #16a34a',maxWidth:340}} onClick={e=>e.stopPropagation()}>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:'#4ade80',marginBottom:4}}>HIKE IN — #{hikeInMod.unit}</div>
            <div style={{fontSize:10,color:'#166534',marginBottom:14}}>Unit stays on yard as Awaiting Arrival</div>
            <div className='field'><label>Coming From</label><input placeholder='e.g. Concord, Belfield…' value={hikeInFrom} onChange={e=>setHikeInFrom(e.target.value)} onKeyDown={e=>e.key==='Enter'&&confirmHikeIn()} autoFocus/></div>
            <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button className='btn btn-ghost' onClick={()=>setHikeInMod(null)}>Cancel</button>
              <button className='btn' style={{background:'#16a34a',color:'#fff'}} onClick={confirmHikeIn}>Confirm</button>
            </div>
          </div>
        </div>
      )}

      {/* hike out modal */}
      {hikeOutMod&&(
        <div className='overlay' onClick={()=>setHikeOutMod(null)}>
          <div className='modal' style={{background:'#fff0f6',border:'1px solid #7c3aed',maxWidth:340}} onClick={e=>e.stopPropagation()}>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:'#c4b5fd',marginBottom:4}}>HIKE OUT — #{hikeOutMod.unit}</div>
            <div style={{fontSize:10,color:'#6b21a8',marginBottom:14}}>Unit removed from yard · added to Hikes ↑</div>
            <div className='field'><label>Destination</label><input placeholder='e.g. Concord, Belfield…' value={hikeOutDest} onChange={e=>setHikeOutDest(e.target.value)} onKeyDown={e=>e.key==='Enter'&&confirmHikeOut()} autoFocus/></div>
            <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button className='btn btn-ghost' onClick={()=>setHikeOutMod(null)}>Cancel</button>
              <button className='btn' style={{background:'#7c3aed',color:'#fff'}} onClick={confirmHikeOut}>Confirm</button>
            </div>
          </div>
        </div>
      )}

      {/* history modal */}
      {histOpen&&(
        <div className='overlay' onClick={()=>setHistOpen(false)}>
          <div className='modal' style={{maxWidth:500,maxHeight:'85vh',overflowY:'auto'}} onClick={e=>e.stopPropagation()}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:'#f59e0b'}}>OPERATIONS HISTORY</div>
              <button onClick={()=>setHistOpen(false)} style={{background:'none',border:'none',color:'#9c6b75',cursor:'pointer',fontSize:18}}>✕</button>
            </div>
            {history.length===0&&<div style={{textAlign:'center',padding:'32px 0',color:'#e8b4bc',fontSize:12}}>No history yet — hit 🌅 New Day to save a snapshot</div>}
            <div style={{display:'flex',flexDirection:'column',gap:8}}>
              {[...history].reverse().map(h=>{
                const yardN=(h.snap.units||[]).filter(u=>!u.wentOut).length
                const resoN=Object.values(h.snap.reso||{}).flat().length
                return(
                  <div key={h.dayNum} style={{background:'#f9f0f2',border:'1px solid #f3c0c8',borderRadius:9,padding:'12px 14px'}}>
                    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:'#f59e0b'}}>Day {h.dayNum} — {h.label}</div>
                    <div style={{display:'flex',gap:16,marginTop:8,flexWrap:'wrap'}}>
                      {[['🚛 Yard',yardN,'#7dd3fc'],['📋 Reso',resoN,'#f59e0b'],['🔴 Ground',(h.snap.grounds||[]).length,'#f87171'],['✅ Tasks',`${(h.snap.tasks||[]).filter(t=>t.done).length}/${(h.snap.tasks||[]).length}`,'#4ade80']].map(([l,v,c])=>(
                        <div key={l} style={{textAlign:'center'}}><div style={{fontSize:14,fontWeight:700,color:c}}>{v}</div><div style={{fontSize:9,color:'#9c6b75'}}>{l}</div></div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {notif&&<div className='notif'>{notif}</div>}
    </div>
  )
}
