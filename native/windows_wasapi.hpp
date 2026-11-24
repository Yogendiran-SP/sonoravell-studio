#pragma once

#include "shared_render.hpp"

namespace sonoravell {
SharedRenderReport runWasapiOutput(PlaybackMixer& mixer, SharedRenderConfig config,
                                  const std::atomic<unsigned>& muteMask, std::atomic<unsigned>& played,
                                  std::stop_token stop) noexcept;
}
