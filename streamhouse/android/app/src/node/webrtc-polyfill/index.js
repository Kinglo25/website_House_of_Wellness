// simple-peer checks `!!RTCPeerConnection` and switches WebRTC off without it;
// bittorrent-tracker and WebTorrent follow its lead. Browser peers are a small
// share of any swarm, so nothing is lost that TCP and UDP peers do not cover.
export const RTCPeerConnection = undefined
export const RTCSessionDescription = undefined
export const RTCIceCandidate = undefined
export default {}
