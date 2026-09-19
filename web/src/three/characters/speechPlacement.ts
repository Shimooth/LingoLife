/** Reserve the projected NPC silhouette, not a percentage of the browser window. */
export function speechPlacement(width:number,height:number,headX:number,headY:number,bodyHeight:number,bubbleHeight=180){
 const gap=16,margin=18,halfBody=Math.max(42,bodyHeight*.3)
 const leftSpace=headX-halfBody-gap-margin
 if(width>=650&&leftSpace>=230){
  const bubbleWidth=Math.min(340,leftSpace),maxHeight=Math.max(76,Math.min(250,height-88))
  const actualHeight=Math.min(bubbleHeight,maxHeight)
  return {mode:'beside',left:headX-halfBody-gap-bubbleWidth,
   top:Math.max(44,Math.min(headY+bodyHeight*.12-36,height-actualHeight-margin)),
   width:bubbleWidth,maxHeight,tailX:bubbleWidth-4}
 }
 // Anchor the actual bottom edge above the head, including short/streamed text.
 const bubbleWidth=Math.min(340,width-margin*2),maxHeight=Math.max(48,Math.min(220,headY-44-gap))
 const left=Math.max(margin,Math.min(headX-bubbleWidth/2,width-bubbleWidth-margin))
 return {mode:'above',left,top:Math.max(44,headY-gap-Math.min(bubbleHeight,maxHeight)),bottom:Math.max(margin,height-headY+gap),
  width:bubbleWidth,maxHeight,tailX:Math.max(22,Math.min(bubbleWidth-32,headX-left-12))}
}
