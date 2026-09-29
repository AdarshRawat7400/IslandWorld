import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Local coordinates in the authored pump house: +z faces its open south door.
// Only the raised front drive assemblies block movement. The rear of both
// machines stays open for inspecting the relay strip and backup controls.
export const PUMP_MACHINE_BLOCKS = Object.freeze([
  Object.freeze({ id: 'generator_drive', x: -2.25, z: -.74, halfWidth: .88, halfDepth: .58 }),
  Object.freeze({ id: 'drain_pump_drive', x: 2.25, z: -.74, halfWidth: .88, halfDepth: .58 }),
]);

const clamp01 = (value) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;

export function pumpInteriorBlocksMove(pumpSite, x, z, radius = .32) {
  if (!pumpSite || pumpSite.id !== 'pump') return false;
  const lx = x - pumpSite.x;
  const lz = z - pumpSite.z;
  return PUMP_MACHINE_BLOCKS.some((block) =>
    Math.abs(lx - block.x) < block.halfWidth + radius
    && Math.abs(lz - block.z) < block.halfDepth + radius);
}

/** Allows older saves or dev probes starting inside a new silhouette to exit. */
export function pumpInteriorBlocksMoveFrom(pumpSite, fromX, fromZ, toX, toZ, radius = .32) {
  if (!pumpSite || pumpSite.id !== 'pump') return false;
  const lx = toX - pumpSite.x;
  const lz = toZ - pumpSite.z;
  const fx = fromX - pumpSite.x;
  const fz = fromZ - pumpSite.z;
  for (const block of PUMP_MACHINE_BLOCKS) {
    const halfWidth = block.halfWidth + radius;
    const halfDepth = block.halfDepth + radius;
    const enters = Math.abs(lx-block.x) < halfWidth && Math.abs(lz-block.z) < halfDepth;
    if (!enters) continue;
    const wasInside = Math.abs(fx-block.x) < halfWidth && Math.abs(fz-block.z) < halfDepth;
    if (!wasInside) return true;
    // Progress toward the nearest exterior edge remains legal; this cannot
    // be used to move further into the machinery.
    const clearance = (x, z) => Math.max(Math.abs(x-block.x)/halfWidth,
      Math.abs(z-block.z)/halfDepth);
    if (clearance(lx,lz) <= clearance(fx,fz)+1e-5) return true;
  }
  return false;
}

/** Original procedural detail over the shipped Blender pump-house shell. */
export function createPumpInterior(scene, terrainHeight, pumpSite) {
  if (!pumpSite || pumpSite.id !== 'pump') throw new Error('A pump-house site is required');
  const group = new THREE.Group();
  group.name = 'Period pump house mechanical interior';
  group.position.set(pumpSite.x, terrainHeight(pumpSite.x, pumpSite.z)+.08, pumpSite.z);
  const mats = {
    plinth: new THREE.MeshStandardMaterial({ color: 0x4c5351, roughness: .96 }),
    iron: new THREE.MeshStandardMaterial({ color: 0x27383c, roughness: .71, metalness: .52 }),
    ironWet: new THREE.MeshStandardMaterial({ color: 0x435457, roughness: .29, metalness: .72 }),
    rust: new THREE.MeshStandardMaterial({ color: 0x704838, roughness: .83, metalness: .33 }),
    brass: new THREE.MeshStandardMaterial({ color: 0x99805a, roughness: .49, metalness: .74 }),
    gasket: new THREE.MeshStandardMaterial({ color: 0x1c282b, roughness: .96 }),
    enamel: new THREE.MeshStandardMaterial({ color: 0xc3c5ad, roughness: .82 }),
    red: new THREE.MeshStandardMaterial({ color: 0x803b30, roughness: .7 }),
    water: new THREE.MeshStandardMaterial({ color: 0x304d56, roughness: .17,
      metalness: .08, transparent: true, opacity: .57, depthWrite: false }),
    puddle: new THREE.MeshStandardMaterial({ color: 0x25373c, roughness: .12,
      metalness: .16, transparent: true, opacity: .35, depthWrite: false,
      side: THREE.DoubleSide }),
  };
  const buckets = new Map(Object.keys(mats).map((key) => [key, []]));
  const movingGeometry = [];
  const movingMaterials = [];
  const transform = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3(1,1,1);
  const quaternion = new THREE.Quaternion();
  const up = new THREE.Vector3(0,1,0);
  const add = (kind, geometry, x, y, z, q = null) => {
    position.set(x,y,z);
    transform.compose(position, q || new THREE.Quaternion(), scale);
    geometry.applyMatrix4(transform);
    buckets.get(kind).push(geometry);
  };
  const box = (kind,x,y,z,w,h,d) => add(kind,new THREE.BoxGeometry(w,h,d),x,y,z);
  const cylinder = (kind,x,y,z,rTop,rBottom,h,segments=12,q=null) =>
    add(kind,new THREE.CylinderGeometry(rTop,rBottom,h,segments),x,y,z,q);
  const torus = (kind,x,y,z,r,tube,segments=20,q=null) =>
    add(kind,new THREE.TorusGeometry(r,tube,5,segments),x,y,z,q);
  const pipe = (kind,from,to,r=.085) => {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const direction = b.clone().sub(a);
    quaternion.setFromUnitVectors(up,direction.clone().normalize());
    cylinder(kind,(a.x+b.x)/2,(a.y+b.y)/2,(a.z+b.z)/2,
      r,r,direction.length(),10,quaternion.clone());
    for (const end of [a,b]) add('rust',new THREE.SphereGeometry(r*1.23,8,6),
      end.x,end.y,end.z);
  };

  // The floor is already present in the Blender shell. These low plinths and
  // iron rail beds align with its blocky equipment without covering the
  // service stations along the back wall.
  for (const side of [-1,1]) {
    const x=side*2.25;
    box('plinth',x,.66,-.78,1.91,.22,1.39);
    for (const railX of [x-.68,x+.68]) box('iron',railX,.78,-.78,.11,.11,1.32);
    box('iron',x,1.12,-.78,1.60,.61,.83);
    box('ironWet',x,1.52,-.78,1.36,.13,.86);
    for (let j=0;j<5;j++) {
      box('rust',x-.56+j*.28,1.88,-.78,.085,.62,.61);
    }
    cylinder('iron',x,1.41,-.93,.42,.53,.84,14);
    cylinder('brass',x,1.88,-.93,.23,.23,.06,12);
    for (const boltX of [x-.65,x+.65]) for (const boltZ of [-1.25,-.31]) {
      cylinder('brass',boltX,.91,boltZ,.055,.055,.045,8);
    }
  }

  // A short diesel backup set on the left and riveted centrifugal volute on
  // the right. The large moving wheels face the central visitor walkway.
  box('rust',-2.25,1.15,-1.43,1.76,.25,.17);
  box('ironWet',-2.25,1.32,-1.47,1.43,.25,.11);
  for (let i=0;i<5;i++) box('iron',-2.77+i*.26,1.55,-1.50,.115,.37,.09);
  pipe('rust',[-2.80,1.77,-1.47],[-2.80,3.04,-1.47],.11);
  cylinder('rust',-2.80,3.04,-1.47,.21,.12,.17,12);
  cylinder('ironWet',2.25,1.38,-1.44,.48,.49,.18,16,
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),Math.PI/2));
  torus('brass',2.25,1.38,-1.57,.33,.055,22);
  for (let j=0;j<7;j++) {
    const a=j*Math.PI*2/7;
    cylinder('brass',2.25+Math.sin(a)*.27,1.38+Math.cos(a)*.27,-1.60,
      .025,.025,.035,6,new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),Math.PI/2));
  }

  // Salt-wet discharge and cable conduits track the rear wall, with a manual
  // valve near the pump and a clear aisle to the service order in the middle.
  pipe('ironWet',[2.88,1.58,-1.44],[3.48,1.58,-1.44],.12);
  pipe('ironWet',[3.48,1.58,-1.44],[3.48,2.46,-3.40],.12);
  pipe('ironWet',[3.48,2.46,-3.40],[4.52,2.46,-3.40],.12);
  pipe('ironWet',[-3.17,2.92,-3.49],[3.48,2.92,-3.49],.075);
  pipe('rust',[-4.38,2.75,-3.49],[-3.17,2.75,-3.49],.07);
  for (const x of [-3.65,-1.80,.20,2.18,4.04]) {
    box('brass',x,2.96,-3.48,.18,.21,.16);
    box('iron',x,2.75,-3.46,.10,.23,.10);
  }
  for (let i=0;i<14;i++) {
    box('ironWet',-4.45+i*.64,2.87,-3.38,.21,.018,.024);
  }

  // Wall-mounted isolator and source diagram: players reach this from the
  // open center lane without colliding with a separate floor cabinet.
  box('gasket',-4.38,1.66,-3.63,.91,1.36,.13);
  box('iron',-4.38,1.66,-3.52,.75,1.18,.10);
  box('enamel',-4.38,2.04,-3.46,.54,.28,.018);
  for (let j=0;j<3;j++) box(j===1?'red':'brass',-4.63+j*.24,1.49,-3.45,.13,.13,.07);
  pipe('brass',[-4.38,1.52,-3.37],[-4.58,1.25,-3.12],.035);
  box('red',-4.58,1.25,-3.12,.22,.095,.13);
  box('iron',0,2.31,-3.65,1.72,.91,.13);
  box('enamel',0,2.31,-3.55,1.53,.72,.016);
  for (let i=0;i<5;i++) {
    box('gasket',-.59+i*.29,2.52-(i%2)*.14,-3.53,.17,.025,.014);
    box('red',-.53+i*.26,2.13+(i%2)*.10,-3.53,.042,.045,.015);
  }

  // Three analog gauges: generator load, discharge pressure, and the tunnel
  // water sight reading. Their needles and fluid respond to equipment state.
  const gaugeCenters=[[-1.48,2.26,-3.41],[1.62,2.26,-3.41],[3.62,2.26,-3.41]];
  for (const [x,y,z] of gaugeCenters) {
    cylinder('iron',x,y,z-.06,.29,.29,.09,20,
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),Math.PI/2));
    add('enamel',new THREE.CircleGeometry(.238,24),x,y,z+.005);
    torus('brass',x,y,z+.02,.245,.025,24);
    for (let i=-2;i<=2;i++) {
      const a=i*.55;
      box('gasket',x+Math.sin(a)*.168,y+Math.cos(a)*.168,z+.025,.018,.045,.01);
    }
  }
  const needles=[];
  for (const [index,[x,y,z]] of gaugeCenters.entries()) {
    const pivot=new THREE.Group();
    pivot.name=['generator load needle','pump pressure needle','tunnel level needle'][index];
    pivot.position.set(x,y,z+.045);
    const needleGeo=new THREE.BoxGeometry(.018,.19,.018);
    movingGeometry.push(needleGeo);
    const needle=new THREE.Mesh(needleGeo,mats.red);
    needle.position.y=.075;
    pivot.add(needle);
    group.add(pivot);
    needles.push(pivot);
  }
  box('brass',4.34,1.66,-3.40,.22,1.38,.11);
  box('gasket',4.34,1.66,-3.32,.13,1.18,.034);
  const waterMaterial=mats.water;
  const waterGeometry=new THREE.BoxGeometry(.095,1,.024);
  movingGeometry.push(waterGeometry);
  const waterColumn=new THREE.Mesh(waterGeometry,waterMaterial);
  waterColumn.name='tunnel water sight glass';
  waterColumn.position.set(4.34,1.73,-3.28);
  group.add(waterColumn);
  for (let i=0;i<6;i++) {
    box('enamel',4.49,1.14+i*.205,-3.32,.08,.018,.028);
  }

  // Valve at the outfall and compact harbor handset near the front-right bench.
  pipe('ironWet',[4.52,2.46,-3.40],[4.52,.91,-3.40],.11);
  torus('brass',4.54,1.35,-3.17,.25,.034,20);
  box('rust',4.54,1.35,-3.15,.44,.055,.06);
  box('rust',4.54,1.35,-3.15,.055,.44,.06);
  box('iron',3.18,1.22,2.43,1.02,.58,.23);
  box('enamel',3.18,1.38,2.56,.68,.20,.03);
  for (let j=0;j<3;j++) cylinder('brass',2.90+j*.26,1.28,2.58,.035,.035,.055,8,
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),Math.PI/2));
  box('gasket',3.18,1.63,2.41,.73,.12,.10);
  box('ironWet',3.18,1.74,2.41,.10,.17,.095);

  // The relay strip remains uncovered on the rear-right bench.
  // Low pooled water and tiny recurring pipe drips catch the intermittent light.
  for (const [x,z,w,d] of [[-1.1,.90,1.55,.84],[1.52,-2.69,1.11,.51],
    [3.85,.46,.75,1.14]]) {
    const puddle=new THREE.CircleGeometry(1,22);
    puddle.rotateX(-Math.PI/2);
    puddle.scale(w,1,d);
    add('puddle',puddle,x,.617,z);
  }

  for (const [name,geometries] of buckets) {
    if (!geometries.length) continue;
    const merged=mergeGeometries(geometries,false);
    if (!merged) throw new Error(`Could not batch pump interior ${name} geometry`);
    geometries.forEach((geometry)=>geometry.dispose());
    const mesh=new THREE.Mesh(merged,mats[name]);
    mesh.name=`pump interior ${name} fixtures`;
    mesh.castShadow=name!=='puddle' && name!=='water';
    mesh.receiveShadow=true;
    group.add(mesh);
  }

  const makeFlywheel=(name,x) => {
    const wheel=new THREE.Group();
    wheel.name=name;
    wheel.position.set(x,1.42,-.73);
    const rimGeometry=new THREE.TorusGeometry(.43,.055,7,24);
    rimGeometry.rotateY(Math.PI/2);
    movingGeometry.push(rimGeometry);
    wheel.add(new THREE.Mesh(rimGeometry,mats.ironWet));
    for (const angle of [0,Math.PI/3,Math.PI*2/3]) {
      const spokeGeometry=new THREE.BoxGeometry(.055,.79,.055);
      spokeGeometry.rotateX(angle);
      movingGeometry.push(spokeGeometry);
      wheel.add(new THREE.Mesh(spokeGeometry,mats.brass));
    }
    const hubGeometry=new THREE.CylinderGeometry(.11,.11,.11,10);
    hubGeometry.rotateZ(Math.PI/2);
    movingGeometry.push(hubGeometry);
    wheel.add(new THREE.Mesh(hubGeometry,mats.rust));
    group.add(wheel);
    return wheel;
  };
  const generatorWheel=makeFlywheel('generator flywheel',-1.31);
  const pumpWheel=makeFlywheel('drain pump flywheel',1.31);
  const lampGeometry=new THREE.SphereGeometry(.07,10,8);
  movingGeometry.push(lampGeometry);
  const activeMat=new THREE.MeshStandardMaterial({color:0xdba65c,emissive:0xffa742,
    emissiveIntensity:0,roughness:.22});
  const drainMat=new THREE.MeshStandardMaterial({color:0x84b2a7,emissive:0x7de2ca,
    emissiveIntensity:0,roughness:.22});
  movingMaterials.push(activeMat,drainMat);
  const generatorLamp=new THREE.Mesh(lampGeometry,activeMat);
  generatorLamp.name='backup generator energized lamp';
  generatorLamp.position.set(-4.58,1.80,-3.35);
  group.add(generatorLamp);
  const pumpLamp=new THREE.Mesh(lampGeometry,drainMat);
  pumpLamp.name='drain pump running lamp';
  pumpLamp.position.set(3.14,1.93,-3.35);
  group.add(pumpLamp);
  const practical=new THREE.PointLight(0xf3af67,0,4.8,2);
  practical.position.set(-2.65,2.82,-1.40);
  group.add(practical);
  const dropGeometry=new THREE.SphereGeometry(.03,6,5);
  movingGeometry.push(dropGeometry);
  const drips=new THREE.InstancedMesh(dropGeometry,mats.water,6);
  drips.name='slow pipe joint condensation';
  drips.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  group.add(drips);
  const dropSites=[[-3.65,-3.48],[-1.80,-3.48],[.20,-3.48],
    [2.18,-3.48],[4.04,-3.48],[3.48,-1.84]];
  const dummy=new THREE.Object3D();
  let dropletTime=0;
  let disposed=false;

  scene.add(group);
  const obstacles=PUMP_MACHINE_BLOCKS.map((block)=>({
    id:block.id, x:pumpSite.x+block.x,z:pumpSite.z+block.z,
    halfWidth:block.halfWidth,halfDepth:block.halfDepth,
  }));
  function update(dt=0,equipment={},drainFraction=0) {
    if (disposed) return;
    const step=Number.isFinite(dt)?Math.max(0,Math.min(.1,dt)):0;
    const standby=equipment.generatorOn===true;
    const pumping=equipment.pumpOn===true;
    const drained=equipment.tunnelDrained===true;
    const drain=drained?1:clamp01(drainFraction);
    generatorWheel.rotation.x+=step*(standby?3.2:0);
    pumpWheel.rotation.x+=step*(pumping?5.8:0);
    needles[0].rotation.z=standby?-1.08:.78;
    needles[1].rotation.z=pumping?-.88:.98;
    needles[2].rotation.z=-.95+drain*1.9;
    activeMat.emissiveIntensity=standby?1.8:.03;
    drainMat.emissiveIntensity=pumping?1.6:.02;
    practical.intensity=standby?.62:0;
    const level=Math.max(.08,1.07*(1-drain));
    waterColumn.scale.y=level;
    waterColumn.position.y=1.10+level/2;
    dropletTime+=step*(pumping?1.55:1);
    dropSites.forEach(([x,z],i)=>{
      const phase=(dropletTime*.53+i*.183)%1;
      dummy.position.set(x,2.65-phase*1.95,z);
      dummy.scale.setScalar(.52+phase*.7);
      dummy.updateMatrix();
      drips.setMatrixAt(i,dummy.matrix);
    });
    drips.instanceMatrix.needsUpdate=true;
  }
  update();

  return {
    group,obstacles,update,
    blocksMove:(x,z,radius=.32)=>pumpInteriorBlocksMove(pumpSite,x,z,radius),
    blocksMoveFrom:(fromX,fromZ,toX,toZ,radius=.32)=>
      pumpInteriorBlocksMoveFrom(pumpSite,fromX,fromZ,toX,toZ,radius),
    dispose(){
      if(disposed)return;
      disposed=true;
      group.parent?.remove(group);
      const geometries=new Set(movingGeometry);
      group.traverse((child)=>{
        if(child.isMesh && child.geometry) geometries.add(child.geometry);
      });
      geometries.forEach((geometry)=>geometry.dispose());
      Object.values(mats).forEach((mat)=>mat.dispose());
      movingMaterials.forEach((mat)=>mat.dispose());
    },
  };
}
