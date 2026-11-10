#pragma once

#include <string>
#include <string_view>

namespace gm::mcp {

std::string sha256_hex(std::string_view bytes);

}
