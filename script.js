const products=[
{id:1,cat:'trainers',brand:'NIKE',name:'Air Force 1 Black / White',price:70,img:'assets/nike-air-force-1.png',badge:'BESTSELLER'},
{id:2,cat:'trainers',brand:'NIKE',name:'Air Force 1 — Boxed Pair',price:75,img:'assets/nike-air-force-box.png',badge:'NEW'},
{id:3,cat:'trainers',brand:'NIKE',name:'Air Force 1 — Sole Detail',price:72,img:'assets/nike-air-force-soles.png',badge:'NEW'},
{id:4,cat:'outerwear',brand:'NIKE',name:'Winter Puffer Jacket',price:65,img:'assets/nike-air-force-box.png',badge:'WINTER'},
{id:5,cat:'tops',brand:'THE NORTH FACE',name:'Fleece / Winter Layer',price:55,img:'assets/nike-air-force-1.png',badge:'WINTER'},
{id:6,cat:'tops',brand:'RALPH LAUREN',name:'Classic Crewneck',price:45,img:'assets/nike-air-force-box.png',badge:'NEW'},
{id:7,cat:'bottoms',brand:'NIKE',name:'Tech Track Pants',price:40,img:'assets/nike-air-force-soles.png',badge:''},
{id:8,cat:'bottoms',brand:'LEVI’S',name:'Straight Fit Jeans',price:42,img:'assets/nike-air-force-box.png',badge:''}
];
let cart=JSON.parse(localStorage.getItem('dansVaultCart')||'[]');
const productsEl=document.getElementById('products');
const cartEl=document.getElementById('cartItems');
const countEl=document.getElementById('cartCount');
const totalEl=document.getElementById('cartTotal');

function money(n){return '£'+n.toFixed(2)}
function renderProducts(filter='all'){
 productsEl.innerHTML=products.filter(p=>filter==='all'||p.cat===filter).map(p=>`
 <article class="product">
  <div class="product-photo">${p.badge?`<span class="badge">${p.badge}</span>`:''}<img src="${p.img}" alt="${p.brand} ${p.name}"></div>
  <div class="product-info"><div class="product-brand">${p.brand}</div><div class="product-name">${p.name}</div>
  <div class="product-meta"><span class="price">${money(p.price)}</span><button class="add" onclick="addToCart(${p.id})">ADD TO BASKET</button></div></div>
 </article>`).join('');
}
function addToCart(id){const p=products.find(x=>x.id===id);cart.push(p);save();openCart()}
function removeFromCart(i){cart.splice(i,1);save()}
function save(){localStorage.setItem('dansVaultCart',JSON.stringify(cart));renderCart()}
function renderCart(){
 countEl.textContent=cart.length;
 cartEl.innerHTML=cart.length?cart.map((p,i)=>`<div class="cart-row"><img src="${p.img}" alt=""><div class="cart-row-info"><strong>${p.brand}</strong><div>${p.name}</div><div>${money(p.price)}</div><button class="remove" onclick="removeFromCart(${i})">Remove</button></div></div>`).join(''):'<p class="small">Your basket is empty.</p>';
 totalEl.textContent=money(cart.reduce((s,p)=>s+p.price,0));
}
function openCart(){document.getElementById('cart').classList.add('open');document.getElementById('overlay').classList.add('show')}
function closeCart(){document.getElementById('cart').classList.remove('open');document.getElementById('overlay').classList.remove('show')}
document.querySelectorAll('.filter').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.filter').forEach(x=>x.classList.remove('active'));b.classList.add('active');renderProducts(b.dataset.filter)}));
document.getElementById('cartOpen').onclick=openCart;
document.getElementById('cartClose').onclick=closeCart;
document.getElementById('overlay').onclick=closeCart;
document.getElementById('checkout').onclick=()=>alert('Checkout is ready for payment integration. Connect Stripe or Shopify before launch.');
renderProducts();renderCart();
