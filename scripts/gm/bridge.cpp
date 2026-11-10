#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <string>
#include <string_view>

#include "gm/json.hpp"
#include "gm/mcp.hpp"

namespace {

char* out_buffer = nullptr;
std::size_t out_length = 0;

void set_out(std::string text) {
    if (out_buffer != nullptr) std::free(out_buffer);
    out_length = text.size();
    out_buffer = static_cast<char*>(std::malloc(out_length + 1));
    if (out_buffer != nullptr) {
        std::memcpy(out_buffer, text.data(), out_length);
        out_buffer[out_length] = '\0';
    }
}

std::string_view in_at(const char* ptr, std::int32_t len) {
    return len > 0 && ptr != nullptr ? std::string_view(ptr, static_cast<std::size_t>(len)) : std::string_view{};
}

}

extern "C" {

__attribute__((export_name("gm_alloc")))
void* gm_alloc(std::int32_t size) {
    return std::malloc(static_cast<std::size_t>(size < 0 ? 0 : size));
}

__attribute__((export_name("gm_free")))
void gm_free(void* ptr) {
    std::free(ptr);
}

__attribute__((export_name("gm_json_len")))
std::int32_t gm_json_len() {
    return static_cast<std::int32_t>(out_length);
}

__attribute__((export_name("gm_json_out")))
char* gm_json_out() {
    return out_buffer;
}

__attribute__((export_name("gm_json_normalize")))
std::int32_t gm_json_normalize(const char* ptr, std::int32_t len) {
    const auto parsed = gm::json::parse(in_at(ptr, len));
    if (!parsed) {
        set_out(std::string("{\"gmError\":") + gm::json::quote(parsed.error()) + "}");
        return 1;
    }
    set_out(gm::json::dump(*parsed));
    return 0;
}

__attribute__((export_name("gm_sha256_hex")))
std::int32_t gm_sha256_hex(const char* ptr, std::int32_t len) {
    set_out(gm::mcp::sha256_hex(in_at(ptr, len)));
    return 0;
}

__attribute__((export_name("gm_core_version")))
std::int32_t gm_core_version() {
    return 1;
}

}
