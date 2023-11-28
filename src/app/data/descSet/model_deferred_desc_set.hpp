#pragma once

#include "../../../vulkan/device/device.hpp"
#include "../../../vulkan/buffer/buffer.hpp"
#include "../../../vulkan/descriptor/descriptor_pool.hpp"
#include "../../../vulkan/descriptor/descriptor_set_layout.hpp"

#include <memory>

namespace NugieApp {
	class ModelDeferredDescSet {
		public:
			ModelDeferredDescSet(NugieVulkan::Device* device, NugieVulkan::DescriptorPool* descriptorPool,
				std::vector<VkDescriptorBufferInfo> uniformBufferInfo[2], VkDescriptorBufferInfo buffersInfo[1],
				std::vector<VkDescriptorImageInfo> renderTextureInfo[1]);
			~ModelDeferredDescSet();

			VkDescriptorSet getDescriptorSets(int frameIndex) { return this->descriptorSets[frameIndex]; }
			NugieVulkan::DescriptorSetLayout* getDescSetLayout() const { return this->descSetLayout; }

		private:
      NugieVulkan::DescriptorSetLayout* descSetLayout;
			std::vector<VkDescriptorSet> descriptorSets;

			void createDescriptor(NugieVulkan::Device* device, NugieVulkan::DescriptorPool* descriptorPool,
				std::vector<VkDescriptorBufferInfo> uniformBufferInfo[2], VkDescriptorBufferInfo buffersInfo[1],
				std::vector<VkDescriptorImageInfo> renderTextureInfo[1]);
	};
	
}