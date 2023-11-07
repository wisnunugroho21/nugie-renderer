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
	class ObjectModel {
    public:
     ObjectModel(NugieVulkan::Device* device);
     ~ObjectModel();

    VkDescriptorBufferInfo getObjectInfo() { return this->objectBuffer->descriptorInfo();  }
    VkDescriptorBufferInfo getBvhInfo() { return this->bvhBuffer->descriptorInfo(); }

    void updateObject(NugieVulkan::CommandBuffer* commandBuffer, std::vector<Object> objects);
    void updateBvh(NugieVulkan::CommandBuffer* commandBuffer, std::vector<BoundBox*> boundBoxes);

    private:
      NugieVulkan::Device* device;
      
      NugieVulkan::Buffer* objectStagingBuffer;
			NugieVulkan::Buffer* objectBuffer;

      NugieVulkan::Buffer* bvhStagingBuffer;
			NugieVulkan::Buffer* bvhBuffer;

      void createObjectBuffers();
			void createBvhBuffers();
	};
} // namespace NugieApp
