const phoneLayout=matchMedia('(max-width: 700px)');
const uploadHome=$('uploadLabel').parentElement;
function setCompare(on){
 $('compare').setAttribute('aria-pressed',String(on));$('canvasZone').classList.toggle('compare',on);$('refPanel').hidden=!on;
 $('mobileDrawing').setAttribute('aria-pressed',String(!on));$('mobileReference').setAttribute('aria-pressed',String(on));layout();
}
function adaptDevice(){
 const mobile=phoneLayout.matches,learning=document.querySelector('.learning');
 if(mobile){$('mobileStages').append(learning);$('viewTools').append($('mobileStages'));document.querySelector('.head-right').prepend($('uploadLabel'));}
 else{document.querySelector('aside').insertBefore(learning,document.querySelector('.stroke-detail'));uploadHome.append($('uploadLabel'));}
 $('uploadLabel').firstChild.textContent=mobile?'＋ 上传图片':'＋ 上传另一张图片';$('resetSample').textContent=mobile?'示例':'示例图片';
 $('viewTools').open=!mobile;setCompare(!mobile);
}
$('mobileDrawing').onclick=()=>setCompare(false);$('mobileReference').onclick=()=>setCompare(true);
phoneLayout.addEventListener('change',adaptDevice);adaptDevice();
