#pragma once

#include "../../../vulkan/device/device.hpp"
#include "../../../vulkan/buffer/buffer.hpp"
#include "../../../vulkan/descriptor/descriptor_pool.hpp"
#include "../../../vulkan/descriptor/descriptor_set_layout.hpp"

#include <memory>

namespace NugieApp {
	class FinalDescSet {
		public:
			FinalDescSet(NugieVulkan::Device* device, NugieVulkan::DescriptorPool* descriptorPool, 
				const std::vector<VkDescriptorImageInfo> &outputImageInfo);
			~FinalDescSet();

			VkDescriptorSet getDescriptorSets(int frameIndex) const { return this->descriptorSets[frameIndex]; }
			NugieVulkan::DescriptorSetLayout* getDescSetLayout() const { return this->descSetLayout; }

			void overwrite(const std::vector<VkDescriptorImageInfo> &outputImageInfo);

		private:
			NugieVulkan::Device* device;
			NugieVulkan::DescriptorPool* descriptorPool;

      NugieVulkan::DescriptorSetLayout* descSetLayout;
			std::vector<VkDescriptorSet> descriptorSets;

			void createDescriptorLayout();
			void createDescriptorSet(const std::vector<VkDescriptorImageInfo> &outputImageInfo);
	};
	
}