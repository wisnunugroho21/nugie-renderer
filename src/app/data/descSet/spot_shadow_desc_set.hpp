#pragma once

#include "../../../vulkan/device/device.hpp"
#include "../../../vulkan/buffer/buffer.hpp"
#include "../../../vulkan/descriptor/descriptor_pool.hpp"
#include "../../../vulkan/descriptor/descriptor_set_layout.hpp"

#include <memory>

namespace NugieApp {
	class SpotShadowDescSet {
		public:
			SpotShadowDescSet(NugieVulkan::Device* device, NugieVulkan::DescriptorPool* descriptorPool, VkDescriptorBufferInfo modelsInfo[2]);
			~SpotShadowDescSet();

			VkDescriptorSet getDescriptorSets(int frameIndex) const { return this->descriptorSets[frameIndex]; }
			NugieVulkan::DescriptorSetLayout* getDescSetLayout() const { return this->descSetLayout; }

		private:
      NugieVulkan::DescriptorSetLayout* descSetLayout;
			std::vector<VkDescriptorSet> descriptorSets;

			void createDescriptor(NugieVulkan::Device* device, NugieVulkan::DescriptorPool* descriptorPool, VkDescriptorBufferInfo modelsInfo[2]);
	};
	
}