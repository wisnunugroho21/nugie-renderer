#pragma once

#include "../../../vulkan/device/device.hpp"
#include "../../../vulkan/buffer/buffer.hpp"
#include "../../../vulkan/command/command_buffer.hpp"
#include "../../utils/bvh/bvh.hpp"
#include "../../general_struct.hpp"

#define GLM_FORCE_RADIANS
#define GLM_FORCE_DEPTH_ZERO_TO_ONE
#include <glm/glm.hpp>

#include <vector>
#include <memory>

namespace NugieApp {
	class PrimitiveModel {
    public:
      PrimitiveModel(NugieVulkan::Device* device);
      ~PrimitiveModel();

      VkDescriptorBufferInfo getPrimitiveInfo() { return this->primitiveBuffer->descriptorInfo();  }
      VkDescriptorBufferInfo getBvhInfo() { return this->bvhBuffer->descriptorInfo(); }

      uint32_t getPrimitiveSize() const { return static_cast<uint32_t>(this->primitives.size()); }
      uint32_t getBvhSize() const { return static_cast<uint32_t>(this->bvhNodes.size()); }

      void addPrimitive(std::vector<Primitive> primitives, std::vector<glm::vec4> positions);
      void clearPrimitive();

      void updatePrimitiveBuffers(NugieVulkan::CommandBuffer* commandBuffer);
      void updateBvhBuffers(NugieVulkan::CommandBuffer* commandBuffer);

      // static std::shared_ptr<std::vector<Primitive>> createPrimitivesFromFile(NugieVulkan::Device &device, const std::string &filePath, uint32_t materialIndex);
      
    private:
      NugieVulkan::Device* device;

      std::vector<Primitive> primitives;
      std::vector<BvhNode> bvhNodes;
      
      NugieVulkan::Buffer* primitiveStagingBuffer;
			NugieVulkan::Buffer* primitiveBuffer;

      NugieVulkan::Buffer* bvhStagingBuffer;
			NugieVulkan::Buffer* bvhBuffer;
      
      std::vector<BvhNode> createBvhData(std::vector<Primitive> primitives, std::vector<glm::vec4> positions);

      void createPrimitiveBuffers();
			void createBvhBuffers();
	};
} // namespace NugieApp
