// The documented animation vocabulary. This is the contract between the
// showrunner (Claude / the user writing episode specs) and the engine.
// The feasibility checker rejects anything not listed here.

export interface ActionDef {
  name: string;
  kind: 'locomotion' | 'body' | 'upper' | 'face' | 'look' | 'speech' | 'prop' | 'group' | 'world' | 'attach' | 'physics';
  blocking: boolean; // advances the actor's sequential cursor
  params: Record<string, string>;
  desc: string;
  gltf?: boolean; // supported by imported glTF characters (mapped to their clips)
}

const A = (name: string, kind: ActionDef['kind'], blocking: boolean, desc: string, params: Record<string, string> = {}, gltf = false): ActionDef => ({ name, kind, blocking, desc, params, gltf });

export const ACTIONS: ActionDef[] = [
  // locomotion
  A('walkTo', 'locomotion', true, 'Walk to a target (anchor, actor, [x,z]).', { to: 'target', speed: 'm/s (default 1.4)', gait: 'walk|sneak|waddle|heavyWalk|crawl', stopShort: 'meters to stop before target', dur: 'seconds (overrides speed)', backward: 'bool: back away while facing the other way' }, true),
  A('runTo', 'locomotion', true, 'Run to a target.', { to: 'target', speed: 'm/s (default 4.5)', gait: 'run|sprint|toddlerRun|panicRun', stopShort: 'm', dur: 's' }, true),
  A('moveAlong', 'locomotion', true, 'Move through a list of waypoints.', { path: '[[x,z],...]', speed: 'm/s', gait: 'gait clip' }, true),
  A('turnTo', 'locomotion', true, 'Turn to face a target or heading (deg).', { target: 'target', heading: 'deg', dur: 's (0.4)' }, true),
  A('jumpTo', 'locomotion', true, 'Jump from current spot to a target, optionally landing at a height (stacking, platforms).', { to: 'target', height: 'apex height m', landY: 'landing height m', dur: 's' }, true),
  A('jump', 'locomotion', true, 'Jump in place.', { height: 'm (0.5)', dur: 's' }, true),
  A('teleport', 'locomotion', true, 'Instantly appear at a target (use on a cut).', { to: 'target', heading: 'deg', y: 'height' }, true),
  A('chase', 'locomotion', true, 'Run after another actor, ending close behind them.', { target: 'actor', dur: 's', gap: 'm', gait: 'gait' }, true),
  A('flee', 'locomotion', true, 'Run directly away from a target.', { from: 'target', distance: 'm', gait: 'gait' }, true),
  // body actions
  ...['idle', 'stand', 'crouch', 'celebrate', 'laugh', 'dance', 'panic', 'shock', 'scared', 'shrug', 'facepalm', 'wave', 'pointUp', 'armsCrossed', 'handsOnHips', 'reachUp', 'block', 'balance', 'cry', 'wail', 'sit', 'lie', 'getUp', 'flail', 'stumble', 'sneeze', 'dribble', 'freeze', 'float', 'talkGesture', 'phoneToEar', 'sitPhone', 'thumbsUpLying', 'push', 'hug'].map((n) =>
    A(n, 'body', true, `Full-body "${n}" animation for a duration.`, { dur: 'seconds', dir: 'for lie/getUp: -1 back, 1 front' }, ['idle', 'stand', 'wave', 'celebrate', 'dance', 'shrug', 'sit', 'lie', 'getUp', 'shock', 'talkGesture', 'push'].includes(n))),
  A('fall', 'body', true, 'Topple over and stay down (then use lie/getUp).', { dir: '-1 backwards, 1 forwards', dur: 's (0.8)' }, true),
  A('point', 'body', true, 'Point at a target.', { target: 'target', dur: 's' }, true),
  A('shoot', 'prop', true, 'Basketball jump shot. Generates the ball flight.', { prop: 'ball id', target: 'hoop|target', outcome: 'make|miss|airball|short', apex: 'm above rim', jump: '0..1.5', flight: 's' }),
  A('dunk', 'prop', true, 'Run-up dunk: jumps at the rim and slams the ball through.', { prop: 'ball id', target: 'hoop' }),
  A('throw', 'prop', true, 'Throw a held prop to a target along an arc.', { prop: 'id', to: 'target', apex: 'm', flight: 's', style: 'over|under' }),
  A('pickUp', 'prop', true, 'Crouch, pick up a prop, hold it.', { prop: 'id', hand: 'R|L|both' }),
  A('hold', 'prop', false, 'Start holding a prop (no animation).', { prop: 'id', hand: 'R|L|both|head' }),
  A('release', 'prop', false, 'Drop a held prop where it is (it falls with physics).', { prop: 'id' }),
  A('grab', 'prop', true, 'Snatch/receive a prop from wherever it is (steal, catch a loose ball).', { prop: 'id', apex: 'm', hold: 's' }),
  A('dribbleTo', 'prop', true, 'Move to a target while dribbling a ball.', { prop: 'id', to: 'target', speed: 'm/s', gait: 'walk|run' }),
  // overlays on top of body
  ...['dribble', 'holdBall', 'raiseBall', 'wave', 'pointUp', 'point', 'armsUp', 'flailArms', 'phoneToEar', 'hug', 'talkGesture', 'armsOut'].map((n) => A(`upper:${n}`, 'upper', false, `Upper-body "${n}" layered on top of the current movement.`, { dur: 's' })),
  // face
  A('face', 'face', false, 'Set facial expression for a duration (default: until changed).', { expr: 'neutral|happy|grin|laugh|smug|shock|scared|terrified|angry|determined|sad|cry|confused|worried|sleepy|guilty|dazed', dur: 's' }, true),
  A('lookAt', 'look', false, 'Turn head (and upper body) toward a target.', { target: 'target', dur: 's', snap: 'bool: sudden head turn' }),
  A('say', 'speech', false, 'Speak a line: generates voice audio, mouth movement and an optional caption.', { text: 'line', voice: 'voice id', caption: 'bool (default true)', wait: 'bool: block until finished', pitch: 'semitones', speed: 'tts speed' }, true),
  // attach / physics
  A('attachTo', 'attach', true, 'Ride/cling to another actor with an offset in their local frame.', { target: 'actor', offset: '[x,y,z]', heading: 'deg', dur: 's' }),
  A('ragdoll', 'physics', true, 'Hand the actor to the physics solver as a tumbling body (simulated, not scripted).', { dur: 's', impulse: '[x,y,z]', spin: '[x,y,z]' }),
  // group actions (crowds)
  A('spawnCrowd', 'group', false, 'Create N crowd members from a template in a formation.', { template: 'character id', count: 'n', formation: 'grid|line|blob|ring', center: '[x,z]', spacing: 'm', facing: 'target' }),
  A('group:runTo', 'group', true, 'All members move to a target keeping their relative spread, with staggered starts.', { to: 'target', spread: 'm', gait: 'gait', speed: 'm/s', stagger: 's' }),
  A('group:formUp', 'group', true, 'Instantly regroup members into a grid formation (use across a cut).', { center: 'target (front-centre of formation)', facing: 'target', spacing: 'm', cols: 'n', gap: 'm offset behind point' }),
  A('group:walkTo', 'group', true, 'All members walk/waddle to a target keeping their relative spread.', { to: 'target', spread: 'm', gait: 'gait', speed: 'm/s', stagger: 's', face: 'target to face on arrival' }),
  A('group:swarm', 'group', true, 'Members surround a target in rings.', { target: 'target', radius: 'm', gait: 'gait', speed: 'm/s' }),
  A('group:scatter', 'group', true, 'Members run away radially from a point.', { from: 'target', distance: 'm', gait: 'gait' }),
  A('group:do', 'group', true, 'Every member performs a body action with staggered timing.', { action: 'body action', dur: 's', stagger: 's', count: 'subset size' }),
  A('group:face', 'group', false, 'Every member changes expression.', { expr: 'expression', stagger: 's' }),
  A('group:lookAt', 'group', false, 'Every member looks at a target (sync=true for a creepy unison turn).', { target: 'target', dur: 's', stagger: 's' }),
  A('group:turnTo', 'group', true, 'Every member turns to face a target.', { target: 'target', stagger: 's' }),
  A('group:cling', 'group', true, 'N members run to and cling onto an actor.', { target: 'actor', count: 'n', dur: 's' }),
  A('group:pileOn', 'group', true, 'Members jump onto a target forming a dogpile (scripted heap).', { target: 'actor|target', count: 'n', stagger: 's' }),
  A('group:sway', 'group', true, 'Wobble a stacked group (tower) side to side.', { dur: 's', amp: 'm', freq: 'Hz', of: 'group id' }),
  A('group:tower', 'group', true, 'Members climb onto each other forming a stacked tower at a spot.', { spot: 'target', rows: '[5,4,3,2,1]', stagger: 's', top: 'actor id to place on top', facing: 'target', rowDelay: 's' }),
  A('group:collapse', 'physics', true, 'Release a tower/stack to the physics solver (simulated outcome).', { dur: 's', push: '[x,y,z] impulse on top', toward: 'target' }),
  A('group:pileTumble', 'physics', true, 'Members become physics bodies and tumble with an impulse.', { dur: 's', from: 'point', power: 'n' }),
  // world
  A('sound', 'world', false, 'Play a sound effect at this scene time.', { id: 'sfx id', gain: 'dB', rate: 'pitch factor' }),
  A('lights', 'world', false, 'Change lighting preset.', { preset: 'set lighting preset', fade: 's' }),
  A('crowd', 'world', false, 'Spectator excitement level.', { level: '0..1', mood: 'cheer|boo' }),
  A('swish', 'world', false, 'Net ripple (court).', {}),
  A('door', 'world', false, 'Open/close the set door.', { open: '0..1', dur: 's', hallLight: 'intensity' }),
  A('phoneRing', 'world', false, 'Landline ringing on/off (apartment).', { on: 'bool' }),
  A('flicker', 'world', false, 'Light flicker.', { dur: 's' }),
  A('gravityDial', 'world', false, 'Lab gravity dial value.', { value: 'g' }),
  A('gravity', 'world', false, 'Set world gravity (in g). Every later physics bake uses it; the lab dial and car suspension react.', { value: 'g (e.g. 0, 0.16, 1, 2, 4...)' }),
  A('collapse', 'physics', false, 'Structural failure of one or more structures. The trigger is scripted; the collapse is simulated under current gravity.', { structures: '[ids]', mode: 'crumble|topple', jitter: 'm/s', blowout: 'm/s (crumble)', kick: '[x,y,z] (topple)', dur: 's' }),
  A('dropProps', 'physics', false, 'Drop a set of props into the physics solver (simulated).', { props: '[ids]', gravity: 'm/s^2', dur: 's' }),
];

export const ACTION_MAP = new Map(ACTIONS.map((a) => [a.name, a]));

export const CAMERA_TYPES: Record<string, string> = {
  static: 'Fixed camera: pos [x,y,z], look target.',
  dolly: 'Camera moves from -> to while looking at a target (look, lookTo).',
  follow: 'Chase cam behind/around a moving target: dist, height, rel (deg relative to heading, 180=behind) or yaw (world deg), lag.',
  track: 'Side-on tracking shot alongside a moving target (follow with rel=90).',
  orbit: 'Circle around a target: radius, height, from/to degrees.',
  close: 'Close-up of an actor part (head by default): dist, rel (0=front), push.',
  ots: 'Over-the-shoulder from one actor to another.',
  top: 'Top-down: target, height, heightTo.',
  wide: 'Auto-framed establishing shot containing targets: yaw, pitch, pad.',
  pov: 'Point of view from an actor\'s head toward a target.',
  ground: 'Low camera sliding along the floor: from, to, look.',
};

export const CAMERA_MODIFIERS = 'fov, zoomTo/zoomAt/zoomDur (punch-in), push (dolly toward subject 0..0.9), handheld (0..2, default 0.6, false=locked), shake {at, amp, decay}, roll (deg), offset, lookOffset, ease';

export const SFX_IDS = ['whistle', 'bounce', 'swish', 'rim', 'squeak', 'thud', 'bigThud', 'whoosh', 'pop', 'boing', 'buzzer', 'crowdCheer', 'crowdGasp', 'crowdAww', 'crowdBoo', 'crowdLaugh', 'riser', 'stinger', 'hit', 'footstep', 'tinyStep', 'record', 'sneeze', 'phoneRing', 'creak', 'drone', 'heartbeat', 'click', 'glitch', 'impact', 'rumble', 'tick', 'alarm', 'dingDing', 'giggle'];
