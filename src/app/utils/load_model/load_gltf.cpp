#include "load_gltf.hpp"

namespace NugieApp {
  GLTFloader::GLTFloader(NugieVulkan::Device *device) : device{device} {}

  std::vector<NugieVulkan::Texture*> GLTFloader::loadTextures(tinygltf::Model& input, NugieVulkan::CommandBuffer* commandBuffers) {
    std::vector<NugieVulkan::Texture*> textures;

    // Images can be stored inside the glTF (which is the case for the sample model), so instead of directly
    // loading them from disk, we fetch them from the glTF loader and upload the buffers
    textures.resize(input.images.size());
    for (size_t i = 0; i < input.images.size(); i++) {
      tinygltf::Image& glTFImage = input.images[i];

      // Get the image data from the glTF loader
      unsigned char* buffer = nullptr;
      VkDeviceSize bufferSize = 0;
      bool deleteBuffer = false;

      // We convert RGB-only images to RGBA, as most devices don't support RGB-formats in Vulkan
      if (glTFImage.component == 3) {
        bufferSize = glTFImage.width * glTFImage.height * 4;
        buffer = new unsigned char[bufferSize];
        unsigned char* rgba = buffer;
        unsigned char* rgb = &glTFImage.image[0];

        for (size_t i = 0; i < glTFImage.width * glTFImage.height; ++i) {
          memcpy(rgba, rgb, sizeof(unsigned char) * 3);
          rgba += 4;
          rgb += 3;
        }

        deleteBuffer = true;
      } else {
        buffer = &glTFImage.image[0];
        bufferSize = glTFImage.image.size();
      }

      textures.emplace_back(new NugieVulkan::Texture(this->device, commandBuffers, buffer, glTFImage.width, glTFImage.height, VK_FILTER_LINEAR, 
			VK_SAMPLER_ADDRESS_MODE_REPEAT, VK_TRUE, VK_BORDER_COLOR_FLOAT_OPAQUE_BLACK, VK_COMPARE_OP_NEVER, VK_SAMPLER_MIPMAP_MODE_LINEAR));

      if (deleteBuffer) {
        delete[] buffer;
      }
    }

    return textures;
  }
} // namespace NugieApp