#!/usr/bin/env bash

turn_number=0

send() {
  printf '%s\n' "$1"
}

while IFS= read -r line; do
  if [[ -n "${MINDS_FAKE_LOG:-}" ]]; then
    printf '%s\n' "$line" >> "$MINDS_FAKE_LOG"
  fi
  method=$(jq -r '.method // ""' <<< "$line")
  id=$(jq -r '.id // empty' <<< "$line")

  case "$method" in
    initialized)
      ;;
    initialize)
      send "$(jq -cn --argjson id "$id" '{id:$id,result:{userAgent:"fake",codexHome:"/tmp",platformFamily:"unix",platformOs:"linux"}}')"
      ;;
    thread/start)
      model=$(jq -r '.params.model // "fake-model"' <<< "$line")
      send "$(jq -cn --argjson id "$id" --arg model "$model" '{id:$id,result:{thread:{id:"thread-1",name:null,preview:"",turns:[]},model:$model}}')"
      ;;
    thread/resume)
      send "$(jq -cn --argjson id "$id" '{id:$id,result:{thread:{id:"thread-1",name:"Saved thread",preview:"Earlier question",turns:[]},model:"fake-model"}}')"
      ;;
    thread/read)
      send "$(jq -cn --argjson id "$id" '{id:$id,result:{thread:{id:"thread-1",turns:[]}}}')"
      ;;
    thread/list)
      send "$(jq -cn --argjson id "$id" '{id:$id,result:{data:[],nextCursor:null}}')"
      ;;
    thread/inject_items|thread/name/set|thread/delete|turn/interrupt)
      send "$(jq -cn --argjson id "$id" '{id:$id,result:{}}')"
      ;;
    turn/start)
      turn_number=$((turn_number + 1))
      turn_id="turn-$turn_number"
      prompt=$(jq -r '.params.input[0].text // ""' <<< "$line")
      send "$(jq -cn --argjson id "$id" --arg turn "$turn_id" '{id:$id,result:{turn:{id:$turn,status:"inProgress"}}}')"
      if [[ "$prompt" == "interrupt case" ]]; then
        send "$(jq -cn --arg turn "$turn_id" '{method:"item/started",params:{threadId:"thread-1",turnId:$turn,item:{type:"agentMessage",id:"partial",phase:"final_answer",text:""}}}')"
        send "$(jq -cn --arg turn "$turn_id" '{method:"item/agentMessage/delta",params:{threadId:"thread-1",turnId:$turn,itemId:"partial",delta:"Partial answer"}}')"
        send "$(jq -cn --arg turn "$turn_id" '{method:"turn/completed",params:{threadId:"thread-1",turn:{id:$turn,status:"interrupted",error:null}}}')"
        continue
      fi
      answer="Signal over noise."
      send "$(jq -cn --arg turn "$turn_id" '{method:"item/started",params:{threadId:"thread-1",turnId:$turn,item:{type:"agentMessage",id:"commentary",phase:"commentary",text:""}}}')"
      send "$(jq -cn --arg turn "$turn_id" '{method:"item/agentMessage/delta",params:{threadId:"thread-1",turnId:$turn,itemId:"commentary",delta:"hidden"}}')"
      send "$(jq -cn --arg turn "$turn_id" '{method:"item/started",params:{threadId:"thread-1",turnId:$turn,item:{type:"agentMessage",id:"final",phase:"final_answer",text:""}}}')"
      send "$(jq -cn --arg turn "$turn_id" --arg answer "$answer" '{method:"item/agentMessage/delta",params:{threadId:"thread-1",turnId:$turn,itemId:"final",delta:$answer}}')"
      send "$(jq -cn --arg turn "$turn_id" --arg answer "$answer" '{method:"item/completed",params:{threadId:"thread-1",turnId:$turn,item:{type:"agentMessage",id:"final",phase:"final_answer",text:$answer}}}')"
      send "$(jq -cn --arg turn "$turn_id" '{method:"turn/completed",params:{threadId:"thread-1",turn:{id:$turn,status:"completed",error:null}}}')"
      ;;
    *)
      if [[ -n "$id" ]]; then
        send "$(jq -cn --argjson id "$id" --arg method "$method" '{id:$id,error:{code:-32601,message:("Unknown method "+$method)}}')"
      fi
      ;;
  esac
done
