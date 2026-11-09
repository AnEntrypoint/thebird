export function lookupPrologue(inPageNames) {
  const names = inPageNames.join('|');
  return `
which() {
  local n rc=0
  [ $# -eq 0 ] && return 1
  for n in "$@"; do
    case "$n" in
      ${names}) echo "$n" ;;
      *) builtin command -v "$n" || rc=1 ;;
    esac
  done
  return $rc
}
command() {
  if [ "$1" = -v ]; then shift; which "$@"; else builtin command "$@"; fi
}
type() {
  local mode= n rc=0
  case "$1" in -t|-p) mode=$1; shift ;; esac
  for n in "$@"; do
    case "$n" in
      ${names})
        case "$mode" in
          -t) echo builtin ;;
          -p) rc=1 ;;
          *) echo "$n is a shell builtin" ;;
        esac ;;
      *)
        if [ -n "$mode" ]; then builtin type "$mode" "$n" || rc=1
        else builtin type "$n" || rc=1
        fi ;;
    esac
  done
  return $rc
}
`
  + inPageNames.map((name) => `${name}() {\n  command ${name} "$@" || return "$(thebird_status)"\n}\n`).join('');
}
