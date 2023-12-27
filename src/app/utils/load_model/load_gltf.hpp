#pragma once

#include "../../../../libraries/tinygltf/tiny_gltf.h"
#include "../../../vulkan/texture/texture.hpp"
#include <vector>

namespace NugieApp {
  class GLTFloader {
    public:
      GLTFloader(NugieVulkan::Device *device);

      std::vector<NugieVulkan::Texture*> loadTextures(tinygltf::Model& input, NugieVulkan::CommandBuffer* commandBuffers);

    private:
      NugieVulkan::Device *device;
  };
}


