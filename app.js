const API = "/api";
let state = { user:null, application:null, pass:null };

const $ = s => document.querySelector(s);
const token = () => localStorage.getItem("lma_token");

function toast(msg){
  const el=$("#toast");
  el.textContent=msg;
  el.classList.add("show");
  setTimeout(()=>el.classList.remove("show"),2800);
}

async function api(path, options={}){
  const headers={"Content-Type":"application/json",...(options.headers||{})};
  if(token()) headers.Authorization=`Bearer ${token()}`;
  const res=await fetch(API+path,{...options,headers});
  let data={};
  try{data=await res.json()}catch{}
  if(!res.ok) throw new Error(data.error||"Request failed");
  return data;
}

function show(id){
  document.querySelectorAll("main > .page").forEach(x=>x.classList.add("hidden"));
  $(id).classList.remove("hidden");
  window.scrollTo({top:0,behavior:"smooth"});
}

function authMode(mode){
  $("#loginPanel").classList.toggle("hidden",mode!=="login");
  $("#registerPanel").classList.toggle("hidden",mode!=="register");
  show("#auth");
}

document.addEventListener("click",e=>{
  if(e.target.dataset.view){
    const v=e.target.dataset.view;
    if(v==="login"||v==="register") authMode(v);
    else show("#"+v);
  }
  if(e.target.dataset.auth) authMode(e.target.dataset.auth);
});

$("#logoutBtn").onclick=()=>{
  localStorage.removeItem("lma_token");
  state={user:null,application:null,pass:null};
  $("#logoutBtn").classList.add("hidden");
  show("#landing");
};

$("#loginForm").onsubmit=async e=>{
  e.preventDefault();
  try{
    const d=await api("/auth",{method:"POST",body:JSON.stringify({
      action:"login",
      email:$("#loginEmail").value.trim(),
      password:$("#loginPassword").value
    })});
    localStorage.setItem("lma_token",d.token);
    await boot();
  }catch(err){toast(err.message)}
};

$("#registerForm").onsubmit=async e=>{
  e.preventDefault();
  try{
    const d=await api("/auth",{method:"POST",body:JSON.stringify({
      action:"register",
      name:$("#regName").value.trim(),
      email:$("#regEmail").value.trim(),
      password:$("#regPassword").value
    })});
    localStorage.setItem("lma_token",d.token);
    await boot();
  }catch(err){toast(err.message)}
};

$("#applyBtn").onclick=()=>{
  $("#applicationCard").classList.remove("hidden");
  const a=state.application;
  $("#studentName").value=a?.studentName||state.user?.name||"";
  $("#studentClass").value=a?.className||"";
  $("#section").value=a?.section||"";
  $("#rollNumber").value=a?.rollNumber||"";
  $("#studentId").value=a?.studentId||"";
  $("#phone").value=a?.phone||"";
  $("#guestCount").value=a?.guestCount??0;
  $("#photoUrl").value=a?.photoUrl||"";
  $("#note").value=a?.note||"";
  window.scrollTo({top:document.body.scrollHeight,behavior:"smooth"});
};

$("#cancelApply").onclick=()=>$("#applicationCard").classList.add("hidden");

$("#applicationForm").onsubmit=async e=>{
  e.preventDefault();
  try{
    const d=await api("/application",{method:"POST",body:JSON.stringify({
      studentName:$("#studentName").value.trim(),
      className:$("#studentClass").value.trim(),
      section:$("#section").value.trim(),
      rollNumber:$("#rollNumber").value.trim(),
      studentId:$("#studentId").value.trim(),
      phone:$("#phone").value.trim(),
      guestCount:Number($("#guestCount").value),
      photoUrl:$("#photoUrl").value.trim(),
      note:$("#note").value.trim()
    })});
    state.application=d.application;
    $("#applicationCard").classList.add("hidden");
    toast("Application submitted.");
    await loadStudent();
  }catch(err){toast(err.message)}
};

async function loadStudent(){
  const d=await api("/application");
  state.application=d.application;
  state.pass=d.pass;
  renderStudent();
}

function renderStudent(){
  $("#welcomeName").textContent=`Welcome, ${state.user.name}`;
  const a=state.application;
  const status=a?.status||"not_submitted";

  $("#statusBadge").textContent=status==="not_submitted"?"NOT SUBMITTED":status.toUpperCase();
  $("#statusBadge").className="status "+(
    status==="approved"?"approved":
    status==="rejected"?"rejected":"pending"
  );

  $("#statusTitle").textContent=!a?"Your pass application":
    status==="approved"?"Pass approved":
    status==="rejected"?"Application needs attention":
    "Application under review";

  $("#statusText").textContent=!a?"Submit your details to start.":
    status==="approved"?"Your digital pass is ready below.":
    status==="rejected"?(a.rejectionReason||"Please contact the school office."):
    "Your application has been received.";

  $("#applyBtn").textContent=a?"Edit Pass Details":"Fill Pass Details";

  if(state.pass){
    $("#passCard").classList.remove("hidden");
    renderPass($("#passMini"),state.pass,true);
  }else{
    $("#passCard").classList.add("hidden");
  }
}

function esc(v){
  return String(v??"").replace(/[&<>"']/g,c=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}

function renderPass(target,p,mini=false){
  const el=typeof target==="string"?$(target):target;
  el.innerHTML=`
    <div class="pass" style="${mini?"margin:18px 0 20px;transform:none":""}">
      <div class="pass-head">
        <div class="pass-brand">LORD MAHAVIRA ACADEMY</div>
        <div class="pass-event">FAREWELL<br>2026–27</div>
      </div>
      <div class="pass-main">
        <div>
          <div class="pass-name">${esc(p.studentName)}</div>
          <div class="pass-meta">
            <div><small>CLASS</small><b>${esc(p.className)}-${esc(p.section)}</b></div>
            <div><small>ROLL NO.</small><b>${esc(p.rollNumber)}</b></div>
            <div><small>PASS ID</small><b>${esc(p.passId)}</b></div>
            <div><small>GUESTS</small><b>${Number(p.guestCount||0)}</b></div>
          </div>
        </div>
        <canvas class="qr"></canvas>
      </div>
      <div class="pass-footer">
        <span>OFFICIAL DIGITAL PASS</span>
        <span>KEEP THIS PASS WITH YOU</span>
      </div>
    </div>`;

  QRCode.toCanvas(el.querySelector("canvas.qr"),p.passId,{
    width:mini?90:110,margin:1
  });
}

async function openPass(){
  if(!state.pass)return;
  show("#passPage");
  renderPass("#passPrintable",state.pass,false);
}

$("#downloadBtn").onclick=openPass;
$("#backDashboard").onclick=()=>show("#dashboard");

async function downloadPass(){
  const node=$("#passPrintable .pass");
  const canvas=await html2canvas(node,{scale:2,backgroundColor:null});
  const a=document.createElement("a");
  a.download=`${state.pass.passId}.png`;
  a.href=canvas.toDataURL("image/png");
  a.click();
}
$("#downloadPass2").onclick=downloadPass;

$("#refreshAdmin").onclick=loadAdmin;

async function loadAdmin(){
  try{
    const d=await api("/admin");
    $("#totalStat").textContent=d.stats.total;
    $("#pendingStat").textContent=d.stats.pending;
    $("#approvedStat").textContent=d.stats.approved;
    $("#rejectedStat").textContent=d.stats.rejected;

    const rows=d.applications.map(a=>`
      <tr>
        <td><b>${esc(a.studentName)}</b><br><span class="muted">${esc(a.userEmail)}</span></td>
        <td>${esc(a.className)}-${esc(a.section)}</td>
        <td>${esc(a.rollNumber)}</td>
        <td><span class="status ${a.status}">${a.status.toUpperCase()}</span></td>
        <td>${new Date(a.createdAt).toLocaleDateString()}</td>
        <td>
          <div class="mini-actions">
            ${a.status!=="approved"?`<button class="small-btn approve" data-action="approve" data-id="${a._id}">Approve</button>`:""}
            ${a.status!=="rejected"?`<button class="small-btn reject" data-action="reject" data-id="${a._id}">Reject</button>`:""}
          </div>
        </td>
      </tr>`).join("");

    $("#adminTable").innerHTML=`
      <table class="admin-table">
        <thead><tr>
          <th>STUDENT</th><th>CLASS</th><th>ROLL</th><th>STATUS</th><th>DATE</th><th>ACTION</th>
        </tr></thead>
        <tbody>${rows||'<tr><td colspan="6">No applications yet.</td></tr>'}</tbody>
      </table>`;
  }catch(err){toast(err.message)}
}

$("#adminTable").onclick=async e=>{
  const btn=e.target.closest("[data-action]");
  if(!btn)return;

  let reason="";
  if(btn.dataset.action==="reject"){
    reason=prompt("Reason for rejection (optional):")||"";
  }

  try{
    await api("/admin",{
      method:"POST",
      body:JSON.stringify({
        action:btn.dataset.action,
        applicationId:btn.dataset.id,
        reason
      })
    });
    toast(btn.dataset.action==="approve"?"Pass approved.":"Application rejected.");
    await loadAdmin();
  }catch(err){toast(err.message)}
};

async function boot(){
  if(!token()){
    $("#logoutBtn").classList.add("hidden");
    show("#landing");
    return;
  }

  try{
    const me=await api("/auth");
    state.user=me.user;
    $("#logoutBtn").classList.remove("hidden");

    if(state.user.role==="admin"){
      show("#admin");
      await loadAdmin();
    }else{
      show("#dashboard");
      await loadStudent();
    }
  }catch{
    localStorage.removeItem("lma_token");
    show("#landing");
  }
}

boot();
