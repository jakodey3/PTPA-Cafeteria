
const DB_NAME = "ptpa_cafeteria_pos";
const DB_VERSION = 1;
const DEFAULT_ADMIN_PIN = "2468";
let db;
let currentMeal = "Lunch";
let selectedStudent = null;

const $ = (id) => document.getElementById(id);
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
};
const timeText = (iso) => new Date(iso).toLocaleTimeString([], {hour:"numeric", minute:"2-digit"});
const dateText = (isoDate) => {
  const [y,m,d] = isoDate.split("-").map(Number);
  return new Date(y,m-1,d).toLocaleDateString();
};
const escapeCSV = (v) => `"${String(v ?? "").replace(/"/g,'""')}"`;

function openDB(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=()=>{
      const database=req.result;
      if(!database.objectStoreNames.contains("students")){
        const s=database.createObjectStore("students",{keyPath:"studentId"});
        s.createIndex("active","active",{unique:false});
      }
      if(!database.objectStoreNames.contains("meals")){
        const m=database.createObjectStore("meals",{keyPath:"id",autoIncrement:true});
        m.createIndex("date","date",{unique:false});
        m.createIndex("studentDateMeal","studentDateMeal",{unique:true});
      }
      if(!database.objectStoreNames.contains("settings")){
        database.createObjectStore("settings",{keyPath:"key"});
      }
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}
function store(name,mode="readonly"){return db.transaction(name,mode).objectStore(name)}
function requestP(req){return new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
async function getSetting(key, fallback){
  const row=await requestP(store("settings").get(key));
  return row ? row.value : fallback;
}
async function setSetting(key,value){await requestP(store("settings","readwrite").put({key,value}))}
async function getStudent(id){return requestP(store("students").get(String(id).trim()))}
async function getAllStudents(){return requestP(store("students").getAll())}
async function saveStudent(student, originalId=null){
  const tx=db.transaction("students","readwrite");
  const s=tx.objectStore("students");
  if(originalId && originalId!==student.studentId) s.delete(originalId);
  s.put(student);
  return new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});
}
async function deleteStudent(id){await requestP(store("students","readwrite").delete(id))}
async function getAllMeals(){return requestP(store("meals").getAll())}
async function addMeal(student, mealType){
  const date=todayISO();
  const now=new Date().toISOString();
  const record={
    studentDateMeal:`${student.studentId}|${date}|${mealType}`,
    date,
    timestamp:now,
    studentId:student.studentId,
    firstName:student.firstName,
    lastName:student.lastName,
    grade:student.grade,
    mealType
  };
  return requestP(store("meals","readwrite").add(record));
}
async function deleteMeal(id){await requestP(store("meals","readwrite").delete(Number(id)))}

function setMessage(text,type="info"){
  const el=$("lastMessage");
  el.textContent=text;
  el.className=`message ${type}`;
}
function initials(s){return `${(s.firstName||"").slice(0,1)}${(s.lastName||"").slice(0,1)}`.toUpperCase() || "ST"}
function clearPOS(){
  selectedStudent=null;
  $("pinDisplay").value="";
  $("studentResult").classList.add("hidden");
  $("studentState").classList.remove("hidden");
}
async function lookupStudent(){
  const pin=$("pinDisplay").value.trim();
  if(!pin){setMessage("Enter a student number.","warning");return}
  const s=await getStudent(pin);
  if(!s || !s.active){
    clearPOS();
    $("pinDisplay").value=pin;
    setMessage("Student number not found or inactive.","error");
    return;
  }
  selectedStudent=s;
  $("studentState").classList.add("hidden");
  $("studentResult").classList.remove("hidden");
  $("studentInitials").textContent=initials(s);
  $("studentName").textContent=`${s.firstName} ${s.lastName}`;
  $("studentMeta").textContent=`Grade ${s.grade}`;
  $("studentIdText").textContent=`Student # ${s.studentId}`;
  $("serveBtn").textContent=`Serve ${currentMeal}`;
  setMessage(`${s.firstName} ${s.lastName} found.`,"info");
}
async function serveSelected(){
  if(!selectedStudent)return;
  try{
    await addMeal(selectedStudent,currentMeal);
    setMessage(`✓ ${currentMeal} recorded for ${selectedStudent.firstName} ${selectedStudent.lastName} at ${new Date().toLocaleTimeString([], {hour:"numeric",minute:"2-digit"})}.`,"success");
    clearPOS();
    await refreshAll();
    setTimeout(()=>$("pinDisplay").focus(),100);
  }catch(err){
    if(err && err.name==="ConstraintError"){
      setMessage(`⚠ ${currentMeal} has already been recorded for this student today.`,"warning");
    }else{
      setMessage("Could not record the meal. Please try again.","error");
      console.error(err);
    }
  }
}
async function todayCounts(){
  const meals=(await getAllMeals()).filter(m=>m.date===todayISO());
  return {
    breakfast:meals.filter(m=>m.mealType==="Breakfast").length,
    lunch:meals.filter(m=>m.mealType==="Lunch").length,
    total:meals.length
  };
}
async function refreshStats(){
  const c=await todayCounts();
  $("todayBreakfast").textContent=c.breakfast;
  $("todayLunch").textContent=c.lunch;
  $("todayTotal").textContent=c.total;
  $("adminBreakfast").textContent=c.breakfast;
  $("adminLunch").textContent=c.lunch;
  $("adminStudents").textContent=(await getAllStudents()).filter(s=>s.active).length;
}
async function renderRoster(){
  const rows=(await getAllStudents()).sort((a,b)=>a.lastName.localeCompare(b.lastName)||a.firstName.localeCompare(b.firstName));
  const body=$("rosterTableBody");
  body.innerHTML="";
  if(!rows.length){
    body.innerHTML='<tr><td colspan="5">No students yet. Add a student or import a CSV roster.</td></tr>';
    return;
  }
  for(const s of rows){
    const tr=document.createElement("tr");
    tr.innerHTML=`<td>${safe(s.studentId)}</td><td>${safe(s.lastName)}, ${safe(s.firstName)}</td><td>${safe(s.grade)}</td><td>${s.active?"Active":"Inactive"}</td>
      <td><button class="icon-btn edit-student" data-id="${encodeURIComponent(s.studentId)}">Edit</button><button class="icon-btn delete-student" data-id="${encodeURIComponent(s.studentId)}">Delete</button></td>`;
    body.appendChild(tr);
  }
}
function safe(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
async function renderMeals(){
  const date=$("reportDate").value || todayISO();
  const mealFilter=$("reportMealFilter").value;
  let rows=(await getAllMeals()).filter(m=>m.date===date && (!mealFilter || m.mealType===mealFilter));
  rows.sort((a,b)=>b.timestamp.localeCompare(a.timestamp));
  const body=$("mealTableBody"); body.innerHTML="";
  if(!rows.length){
    body.innerHTML='<tr><td colspan="7">No meal records for this selection.</td></tr>';
    return;
  }
  for(const m of rows){
    const tr=document.createElement("tr");
    tr.innerHTML=`<td>${dateText(m.date)}</td><td>${timeText(m.timestamp)}</td><td>${safe(m.studentId)}</td><td>${safe(m.lastName)}, ${safe(m.firstName)}</td><td>${safe(m.grade)}</td><td>${safe(m.mealType)}</td>
      <td><button class="icon-btn delete-meal" data-id="${m.id}">Delete</button></td>`;
    body.appendChild(tr);
  }
}
async function refreshAll(){await refreshStats(); if($("adminView").classList.contains("active")){await renderRoster();await renderMeals()}}

function showAdminPin(){
  $("adminPinInput").value="";
  $("adminPinError").classList.add("hidden");
  $("adminPinDialog").showModal();
  setTimeout(()=>$("adminPinInput").focus(),100);
}
async function unlockAdmin(e){
  e.preventDefault();
  const expected=await getSetting("adminPin",DEFAULT_ADMIN_PIN);
  if($("adminPinInput").value!==expected){
    $("adminPinError").classList.remove("hidden");
    return;
  }
  $("adminPinDialog").close();
  $("posView").classList.remove("active");
  $("adminView").classList.add("active");
  $("reportDate").value=todayISO();
  await refreshAll();
}
function backToPOS(){
  $("adminView").classList.remove("active");
  $("posView").classList.add("active");
  clearPOS();
  $("pinDisplay").focus();
}
function openAddStudent(student=null){
  $("studentFormError").classList.add("hidden");
  $("studentDialogTitle").textContent=student?"Edit Student":"Add Student";
  $("editingOriginalId").value=student?.studentId||"";
  $("formStudentId").value=student?.studentId||"";
  $("formFirstName").value=student?.firstName||"";
  $("formLastName").value=student?.lastName||"";
  $("formGrade").value=student?.grade||"";
  $("formActive").checked=student?!!student.active:true;
  $("studentDialog").showModal();
}
async function saveStudentForm(e){
  e.preventDefault();
  const student={
    studentId:$("formStudentId").value.trim(),
    firstName:$("formFirstName").value.trim(),
    lastName:$("formLastName").value.trim(),
    grade:$("formGrade").value.trim(),
    active:$("formActive").checked
  };
  if(!student.studentId||!student.firstName||!student.lastName||!student.grade){
    $("studentFormError").textContent="Complete all required fields.";
    $("studentFormError").classList.remove("hidden");
    return;
  }
  const original=$("editingOriginalId").value||null;
  const existing=await getStudent(student.studentId);
  if(existing && original!==student.studentId){
    $("studentFormError").textContent="That student number is already in use.";
    $("studentFormError").classList.remove("hidden");
    return;
  }
  await saveStudent(student,original);
  $("studentDialog").close();
  await refreshAll();
}
function parseCSV(text){
  const rows=[]; let row=[], cell="", q=false;
  for(let i=0;i<text.length;i++){
    const c=text[i], n=text[i+1];
    if(c==='"' && q && n==='"'){cell+='"';i++}
    else if(c==='"'){q=!q}
    else if(c===',' && !q){row.push(cell);cell=""}
    else if((c==='\n'||c==='\r')&&!q){
      if(c==='\r'&&n==='\n')i++;
      row.push(cell); cell="";
      if(row.some(x=>x.trim()!=="")) rows.push(row);
      row=[];
    } else cell+=c;
  }
  row.push(cell); if(row.some(x=>x.trim()!=="")) rows.push(row);
  return rows;
}
async function importRoster(file){
  const text=await file.text();
  const rows=parseCSV(text);
  if(rows.length<2){alert("CSV appears empty.");return}
  const headers=rows[0].map(h=>h.trim().toLowerCase().replace(/\s+/g,""));
  const idx={
    studentId:headers.findIndex(h=>["studentid","student#","studentnumber","id","pin"].includes(h)),
    firstName:headers.findIndex(h=>["firstname","first"].includes(h)),
    lastName:headers.findIndex(h=>["lastname","last"].includes(h)),
    grade:headers.findIndex(h=>["grade","gradelevel"].includes(h)),
    active:headers.findIndex(h=>["active","status"].includes(h))
  };
  if([idx.studentId,idx.firstName,idx.lastName,idx.grade].some(i=>i<0)){
    alert("CSV headers must include StudentID, FirstName, LastName, and Grade.");
    return;
  }
  let count=0;
  for(const r of rows.slice(1)){
    const studentId=(r[idx.studentId]||"").trim();
    if(!studentId)continue;
    let active=true;
    if(idx.active>=0){
      const v=(r[idx.active]||"").trim().toLowerCase();
      active=!["false","0","inactive","no","n"].includes(v);
    }
    await saveStudent({studentId,firstName:(r[idx.firstName]||"").trim(),lastName:(r[idx.lastName]||"").trim(),grade:(r[idx.grade]||"").trim(),active});
    count++;
  }
  alert(`${count} student record(s) imported.`);
  await refreshAll();
}
function download(filename,text,type="text/plain"){
  const blob=new Blob([text],{type});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);a.download=filename;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href),500);
}
async function exportRoster(){
  const rows=await getAllStudents();
  const lines=["StudentID,FirstName,LastName,Grade,Active",...rows.map(s=>[s.studentId,s.firstName,s.lastName,s.grade,s.active].map(escapeCSV).join(","))];
  download(`PTPA_Roster_${todayISO()}.csv`,lines.join("\n"),"text/csv");
}
async function exportMeals(){
  const date=$("reportDate").value||todayISO();
  const mealFilter=$("reportMealFilter").value;
  const rows=(await getAllMeals()).filter(m=>m.date===date&&(!mealFilter||m.mealType===mealFilter)).sort((a,b)=>a.timestamp.localeCompare(b.timestamp));
  const lines=["Date,Time,StudentID,FirstName,LastName,Grade,MealType",...rows.map(m=>[
    m.date,timeText(m.timestamp),m.studentId,m.firstName,m.lastName,m.grade,m.mealType
  ].map(escapeCSV).join(","))];
  download(`PTPA_Meals_${date}${mealFilter?`_${mealFilter}`:""}.csv`,lines.join("\n"),"text/csv");
}
async function backupAll(){
  const data={
    app:"PTPA Cafeteria POS",
    version:1,
    exportedAt:new Date().toISOString(),
    students:await getAllStudents(),
    meals:await getAllMeals(),
    settings:{adminPin:await getSetting("adminPin",DEFAULT_ADMIN_PIN)}
  };
  download(`PTPA_Cafeteria_Backup_${todayISO()}.json`,JSON.stringify(data,null,2),"application/json");
}
async function clearStore(name){
  await requestP(store(name,"readwrite").clear());
}
async function restoreBackup(file){
  if(!confirm("Restore this backup? Existing roster and meal records will be replaced."))return;
  const data=JSON.parse(await file.text());
  if(!Array.isArray(data.students)||!Array.isArray(data.meals)) throw new Error("Invalid backup");
  await clearStore("students");await clearStore("meals");
  for(const s of data.students) await saveStudent(s);
  for(const m of data.meals){
    const clone={...m}; delete clone.id;
    await requestP(store("meals","readwrite").add(clone));
  }
  if(data.settings?.adminPin)await setSetting("adminPin",data.settings.adminPin);
  await refreshAll();
  alert("Backup restored.");
}
async function changePin(e){
  e.preventDefault();
  const a=$("newAdminPin").value,b=$("confirmAdminPin").value;
  if(a.length<4||a!==b){
    $("changePinError").textContent=a!==b?"PINs do not match.":"PIN must be at least 4 digits.";
    $("changePinError").classList.remove("hidden");
    return;
  }
  await setSetting("adminPin",a);
  $("changePinDialog").close();
  alert("Admin PIN changed.");
}
function updateOnline(){
  $("onlineStatus").textContent=navigator.onLine?"Online • Offline-ready":"Offline mode";
}
async function init(){
  db=await openDB();
  if((await getSetting("adminPin",null))===null)await setSetting("adminPin",DEFAULT_ADMIN_PIN);
  $("reportDate").value=todayISO();
  await refreshStats();
  updateOnline();

  document.querySelectorAll(".meal-btn").forEach(btn=>btn.addEventListener("click",()=>{
    currentMeal=btn.dataset.meal;
    document.querySelectorAll(".meal-btn").forEach(b=>b.classList.toggle("active",b===btn));
    if(selectedStudent)$("serveBtn").textContent=`Serve ${currentMeal}`;
  }));
  $("keypad").addEventListener("click",(e)=>{
    const btn=e.target.closest("button");if(!btn)return;
    if(btn.dataset.key!==undefined){
      if($("pinDisplay").value.length<12)$("pinDisplay").value+=btn.dataset.key;
    }else if(btn.dataset.action==="clear")$("pinDisplay").value="";
    else if(btn.dataset.action==="lookup")lookupStudent();
  });
  $("pinDisplay").addEventListener("keydown",(e)=>{if(e.key==="Enter")lookupStudent()});
  $("serveBtn").addEventListener("click",serveSelected);
  $("cancelStudentBtn").addEventListener("click",clearPOS);
  $("adminBtn").addEventListener("click",showAdminPin);
  $("adminPinForm").addEventListener("submit",unlockAdmin);
  $("backToPosBtn").addEventListener("click",backToPOS);
  $("addStudentBtn").addEventListener("click",()=>openAddStudent());
  $("studentForm").addEventListener("submit",saveStudentForm);
  $("rosterTableBody").addEventListener("click",async(e)=>{
    const edit=e.target.closest(".edit-student"), del=e.target.closest(".delete-student");
    if(edit){const s=await getStudent(decodeURIComponent(edit.dataset.id));openAddStudent(s)}
    if(del){
      const id=decodeURIComponent(del.dataset.id);
      if(confirm(`Delete student ${id}? Existing meal records will remain.`)){await deleteStudent(id);await refreshAll()}
    }
  });
  $("mealTableBody").addEventListener("click",async(e)=>{
    const btn=e.target.closest(".delete-meal");if(!btn)return;
    if(confirm("Delete this meal record?")){await deleteMeal(btn.dataset.id);await refreshAll()}
  });
  $("importRosterInput").addEventListener("change",async(e)=>{
    const f=e.target.files[0]; if(f){try{await importRoster(f)}catch(err){alert("Roster import failed: "+err.message)}}
    e.target.value="";
  });
  $("exportRosterBtn").addEventListener("click",exportRoster);
  $("refreshReportBtn").addEventListener("click",renderMeals);
  $("reportDate").addEventListener("change",renderMeals);
  $("reportMealFilter").addEventListener("change",renderMeals);
  $("exportMealsBtn").addEventListener("click",exportMeals);
  $("backupBtn").addEventListener("click",backupAll);
  $("restoreInput").addEventListener("change",async(e)=>{
    const f=e.target.files[0];if(f){try{await restoreBackup(f)}catch(err){alert("Restore failed: "+err.message)}}
    e.target.value="";
  });
  $("changePinBtn").addEventListener("click",()=>{
    $("newAdminPin").value="";$("confirmAdminPin").value="";$("changePinError").classList.add("hidden");$("changePinDialog").showModal();
  });
  $("changePinForm").addEventListener("submit",changePin);
  $("clearMealsBtn").addEventListener("click",async()=>{
    if(confirm("This will permanently delete ALL meal records on this device. Continue?")){
      if(confirm("Final confirmation: delete ALL meal records?")){await clearStore("meals");await refreshAll();alert("All meal records deleted.")}
    }
  });
  window.addEventListener("online",updateOnline);window.addEventListener("offline",updateOnline);
  if("serviceWorker" in navigator && location.protocol.startsWith("http")){
    navigator.serviceWorker.register("./service-worker.js").catch(console.error);
  }
  $("pinDisplay").focus();
}
document.addEventListener("DOMContentLoaded",init);
